import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { agentsConfig } from '../../config';
import { NodesService } from './nodes.service';

@Injectable()
export class NodeOfflineDetectorService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(NodeOfflineDetectorService.name);
  private readonly intervalName = 'node-offline-detector';
  private isRunning = false;

  constructor(
    private readonly nodesService: NodesService,
    private readonly configService: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    const agents = this.configService.getOrThrow<
      ConfigType<typeof agentsConfig>
    >(agentsConfig.KEY);

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
      await this.nodesService.markStaleNodesOffline();
    } catch (error) {
      const message =
        error instanceof Error ? (error.stack ?? error.message) : String(error);
      this.logger.error('Stale node detection failed', message);
    } finally {
      this.isRunning = false;
    }
  }
}
