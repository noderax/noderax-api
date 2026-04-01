import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AgentUpdatesService } from './agent-updates.service';

@Injectable()
export class AgentUpdateRolloutMonitorService {
  private readonly logger = new Logger(AgentUpdateRolloutMonitorService.name);

  constructor(private readonly agentUpdatesService: AgentUpdatesService) {}

  @Cron('*/15 * * * * *')
  async reconcileActiveTargets(): Promise<void> {
    const pausedTargets =
      await this.agentUpdatesService.reconcileActiveTargets();
    if (pausedTargets > 0) {
      this.logger.warn(
        `Paused ${pausedTargets} agent update target${pausedTargets === 1 ? '' : 's'} after rollout health checks.`,
      );
    }
  }
}
