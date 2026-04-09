import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ClusterLockService } from '../../runtime/cluster-lock.service';
import { AgentUpdatesService } from './agent-updates.service';

@Injectable()
export class AgentUpdateRolloutMonitorService {
  private readonly logger = new Logger(AgentUpdateRolloutMonitorService.name);
  private isRunning = false;

  constructor(
    private readonly agentUpdatesService: AgentUpdatesService,
    private readonly clusterLockService: ClusterLockService,
  ) {}

  @Cron('*/15 * * * * *')
  async reconcileActiveTargets(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;

    try {
      const run = await this.clusterLockService.runWithLock(
        'agent-update-rollout-monitor',
        () => this.agentUpdatesService.reconcileActiveTargets(),
      );

      if (!run.acquired) {
        this.logger.debug(
          'Skipping rollout reconciliation because another API instance currently owns the cluster lock',
        );
        return;
      }

      const pausedTargets = run.result ?? 0;
      if (pausedTargets > 0) {
        this.logger.warn(
          `Paused ${pausedTargets} agent update target${pausedTargets === 1 ? '' : 's'} after rollout health checks.`,
        );
      }
    } finally {
      this.isRunning = false;
    }
  }
}
