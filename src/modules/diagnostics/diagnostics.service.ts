import { Injectable } from '@nestjs/common';
import { AgentRealtimeService } from '../agent-realtime/agent-realtime.service';
import { TasksService } from '../tasks/tasks.service';
import { TaskFlowDiagnosticsResponseDto } from './dto/task-flow-diagnostics-response.dto';

@Injectable()
export class DiagnosticsService {
  constructor(
    private readonly agentRealtimeService: AgentRealtimeService,
    private readonly tasksService: TasksService,
  ) {}

  async getTaskFlowDiagnostics(): Promise<TaskFlowDiagnosticsResponseDto> {
    const fetchedAt = new Date().toISOString();

    const agentCounters = this.agentRealtimeService.getCountersSnapshot();
    const realtimeHealth =
      this.agentRealtimeService.getRealtimeHealthSnapshot();
    const claimStats = this.tasksService.getClaimStatsSnapshot();
    const queue = await this.tasksService.getQueueSnapshot();
    const lastClaimAt = this.tasksService.getLastClaimAtIso();

    const claimFailed =
      (claimStats.claim_error_total ?? 0) +
      (claimStats.claim_unauthorized_total ?? 0);

    return {
      fetchedAt,
      source: 'agent-task-flow',
      agentCounters: {
        'metrics.ingested': agentCounters['metrics.ingested'] ?? 0,
        'connection.opened': agentCounters['connection.opened'] ?? 0,
      },
      claimCounters: {
        'task.claim.attempted': claimStats.claim_request_total ?? 0,
        'task.claim.succeeded': claimStats.claim_success_total ?? 0,
        'task.claim.failed': claimFailed,
        'task.claim.emptyPoll': claimStats.claim_empty_total ?? 0,
      },
      queue: {
        queued: queue.queued ?? 0,
        running: queue.running ?? 0,
      },
      health: {
        realtimeConnected: realtimeHealth.realtimeConnected,
        lastAgentSeenAt: realtimeHealth.lastAgentSeenAt,
        lastClaimAt,
      },
    };
  }
}
