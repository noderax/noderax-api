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
import { NodesService } from './nodes.service';

@Injectable()
export class NodeOfflineDetectorService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(NodeOfflineDetectorService.name);
  private readonly intervalName = 'node-offline-detector';
  private isRunning = false;
  private hasLoggedMissingNodesTable = false;

  constructor(
    private readonly nodesService: NodesService,
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
      void this.runOfflineDetection();
    }, agents.offlineCheckIntervalSeconds * 1000);

    this.schedulerRegistry.addInterval(this.intervalName, interval);
    this.logger.log(
      `Scheduled stale node detection every ${agents.offlineCheckIntervalSeconds} seconds`,
    );

    void this.runOfflineDetection();
  }

  onModuleDestroy(): void {
    if (!this.schedulerRegistry.doesExist('interval', this.intervalName)) {
      return;
    }

    this.schedulerRegistry.deleteInterval(this.intervalName);
  }

  private async runOfflineDetection(): Promise<void> {
    if (this.isRunning) {
      this.logger.debug(
        'Skipping stale node detection because the previous run is still in progress',
      );
      return;
    }

    this.isRunning = true;

    try {
      if (!(await this.hasTable('nodes'))) {
        if (!this.hasLoggedMissingNodesTable) {
          this.logger.warn(
            'Skipping stale node detection because the "nodes" table does not exist',
          );
          this.hasLoggedMissingNodesTable = true;
        }

        return;
      }

      this.hasLoggedMissingNodesTable = false;

      const run = await this.clusterLockService.runWithLock(
        this.intervalName,
        () => this.nodesService.markStaleNodesOffline(),
      );

      if (!run.acquired) {
        this.logger.debug(
          'Skipping stale node detection because another API instance currently owns the cluster lock',
        );
      }
    } catch (error) {
      const message =
        error instanceof Error ? (error.stack ?? error.message) : String(error);
      this.logger.error('Stale node detection failed', message);
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
