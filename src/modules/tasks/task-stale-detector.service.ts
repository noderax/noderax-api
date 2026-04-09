import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { AGENTS_CONFIG_KEY, agentsConfig } from '../../config';
import { ClusterLockService } from '../../runtime/cluster-lock.service';
import { TasksService } from './tasks.service';

@Injectable()
export class TaskStaleDetectorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TaskStaleDetectorService.name);
  private readonly intervalName = 'task-stale-detector';
  private isRunning = false;
  private hasLoggedMissingTasksTable = false;
  private lastFailedCount = 0;
  private totalFailedCount = 0;

  constructor(
    private readonly tasksService: TasksService,
    private readonly configService: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly dataSource: DataSource,
    private readonly clusterLockService: ClusterLockService,
  ) {}

  onModuleInit(): void {
    const agents =
      this.configService.getOrThrow<ConfigType<typeof agentsConfig>>(
        AGENTS_CONFIG_KEY,
      );

    const interval = setInterval(() => {
      void this.runStaleTaskDetection();
    }, agents.staleTaskCheckIntervalSeconds * 1000);

    this.schedulerRegistry.addInterval(this.intervalName, interval);
    this.logger.log(
      `Scheduled stale task detection every ${agents.staleTaskCheckIntervalSeconds} seconds`,
    );

    void this.runStaleTaskDetection();
  }

  onModuleDestroy(): void {
    if (!this.schedulerRegistry.doesExist('interval', this.intervalName)) {
      return;
    }

    this.schedulerRegistry.deleteInterval(this.intervalName);
  }

  getOperationalSnapshot() {
    return {
      lastFailedCount: this.lastFailedCount,
      totalFailedCount: this.totalFailedCount,
    };
  }

  private async runStaleTaskDetection(): Promise<void> {
    if (this.isRunning) {
      this.logger.debug(
        'Skipping stale task detection because the previous run is still in progress',
      );
      return;
    }

    const agents =
      this.configService.getOrThrow<ConfigType<typeof agentsConfig>>(
        AGENTS_CONFIG_KEY,
      );

    this.isRunning = true;

    try {
      if (!(await this.hasTable('tasks'))) {
        if (!this.hasLoggedMissingTasksTable) {
          this.logger.warn(
            'Skipping stale task detection because the "tasks" table does not exist',
          );
          this.hasLoggedMissingTasksTable = true;
        }

        return;
      }

      this.hasLoggedMissingTasksTable = false;

      const run = await this.clusterLockService.runWithLock(
        this.intervalName,
        () =>
          this.tasksService.failStaleTasks({
            queuedTimeoutSeconds: agents.staleQueuedTaskTimeoutSeconds,
            runningTimeoutSeconds: agents.staleRunningTaskTimeoutSeconds,
          }),
      );

      if (!run.acquired) {
        this.logger.debug(
          'Skipping stale task detection because another API instance currently owns the cluster lock',
        );
        return;
      }

      const failedCount = run.result ?? 0;
      this.lastFailedCount = failedCount;
      this.totalFailedCount += failedCount;

      if (failedCount > 0) {
        this.logger.warn(
          `Marked ${failedCount} stale tasks as failed (queued>${agents.staleQueuedTaskTimeoutSeconds}s, running>${agents.staleRunningTaskTimeoutSeconds}s)`,
        );
      }
    } catch (error) {
      const message =
        error instanceof Error ? (error.stack ?? error.message) : String(error);
      this.logger.error('Stale task detection failed', message);
    } finally {
      this.isRunning = false;
    }
  }

  private async hasTable(tableName: string): Promise<boolean> {
    const result = (await this.dataSource.query(
      `
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name = $1
        ) AS "exists"
      `,
      [tableName],
    )) as Array<{ exists: boolean }>;

    return Boolean(result[0]?.exists);
  }
}
