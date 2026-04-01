import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AgentUpdatesService } from './agent-updates.service';

@Injectable()
export class AgentUpdateRolloutMonitorService {
  private readonly logger = new Logger(AgentUpdateRolloutMonitorService.name);

  constructor(private readonly agentUpdatesService: AgentUpdatesService) {}

  @Cron('*/15 * * * * *')
  async markTimedOutTargets(): Promise<void> {
    const timedOut = await this.agentUpdatesService.markTimedOutTargets();
    if (timedOut > 0) {
      this.logger.warn(
        `Paused ${timedOut} agent update target${timedOut === 1 ? '' : 's'} after timeout detection.`,
      );
    }
  }
}
