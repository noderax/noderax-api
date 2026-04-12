import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ClusterLockService } from '../../runtime/cluster-lock.service';
import { ControlPlaneUpdatesService } from './control-plane-updates.service';

@Injectable()
export class ControlPlaneUpdateMonitorService {
  private readonly logger = new Logger(ControlPlaneUpdateMonitorService.name);
  private isRunning = false;

  constructor(
    private readonly controlPlaneUpdatesService: ControlPlaneUpdatesService,
    private readonly clusterLockService: ClusterLockService,
  ) {}

  @Cron('*/15 * * * * *')
  async reconcileTerminalState(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;

    try {
      const run = await this.clusterLockService.runWithLock(
        'control-plane-update-monitor',
        () => this.controlPlaneUpdatesService.reconcileTerminalAuditState(),
      );

      if (!run.acquired) {
        this.logger.debug(
          'Skipping control-plane update monitor because another API instance currently owns the cluster lock',
        );
        return;
      }
    } finally {
      this.isRunning = false;
    }
  }
}
