import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { AGENTS_CONFIG_KEY, agentsConfig } from '../../config';
import { TasksService } from './tasks.service';

@Injectable()
export class TaskStaleDetectorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TaskStaleDetectorService.name);
  private readonly intervalName = 'task-stale-detector';
  private isRunning = false;

  constructor(
    private readonly tasksService: TasksService,
    private readonly configService: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
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
      const failedCount = await this.tasksService.failStaleTasks({
        queuedTimeoutSeconds: agents.staleQueuedTaskTimeoutSeconds,
        runningTimeoutSeconds: agents.staleRunningTaskTimeoutSeconds,
      });

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
}
