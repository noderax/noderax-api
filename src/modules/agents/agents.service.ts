import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PUBSUB_CHANNELS } from '../../common/constants/pubsub.constants';
import { SYSTEM_EVENT_TYPES } from '../../common/constants/system-event.constants';
import { RedisService } from '../../redis/redis.service';
import { EventSeverity } from '../events/entities/event-severity.enum';
import { EventsService } from '../events/events.service';
import { NodeStatus } from '../nodes/entities/node-status.enum';
import { NodesService } from '../nodes/nodes.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { AgentHeartbeatResponseDto } from './dto/agent-heartbeat-response.dto';
import { AgentHeartbeatDto } from './dto/agent-heartbeat.dto';
import { AgentRegisterResponseDto } from './dto/agent-register-response.dto';
import { AgentRegisterDto } from './dto/agent-register.dto';

@Injectable()
export class AgentsService {
  constructor(
    private readonly nodesService: NodesService,
    private readonly eventsService: EventsService,
    private readonly realtimeGateway: RealtimeGateway,
    private readonly redisService: RedisService,
  ) {}

  async register(
    agentRegisterDto: AgentRegisterDto,
  ): Promise<AgentRegisterResponseDto> {
    const agentToken = randomBytes(32).toString('hex');
    const agentTokenHash = this.nodesService.hashAgentToken(agentToken);

    const node = await this.nodesService.upsertFromAgentRegistration({
      hostname: agentRegisterDto.hostname,
      os: agentRegisterDto.os,
      arch: agentRegisterDto.arch,
      agentTokenHash,
    });

    await this.eventsService.record({
      nodeId: node.id,
      type: SYSTEM_EVENT_TYPES.NODE_REGISTERED,
      severity: EventSeverity.INFO,
      message: `Node ${node.hostname} registered with the control plane`,
    });

    const statusPayload = {
      nodeId: node.id,
      hostname: node.hostname,
      status: node.status,
      lastSeenAt: node.lastSeenAt,
    };

    this.realtimeGateway.emitNodeStatusUpdate(statusPayload);
    await this.redisService.publish(
      PUBSUB_CHANNELS.NODES_STATUS_UPDATED,
      statusPayload,
    );

    return {
      nodeId: node.id,
      agentToken,
    };
  }

  async heartbeat(
    agentHeartbeatDto: AgentHeartbeatDto,
  ): Promise<AgentHeartbeatResponseDto> {
    const node = await this.nodesService.authenticateAgent(
      agentHeartbeatDto.nodeId,
      agentHeartbeatDto.agentToken,
    );
    const wasOffline = node.status === NodeStatus.OFFLINE;
    const updatedNode = await this.nodesService.touchOnline(node.id);

    if (wasOffline) {
      await this.eventsService.record({
        nodeId: updatedNode.id,
        type: SYSTEM_EVENT_TYPES.NODE_ONLINE,
        severity: EventSeverity.INFO,
        message: `Node ${updatedNode.hostname} is back online`,
      });
    }

    const statusPayload = {
      nodeId: updatedNode.id,
      hostname: updatedNode.hostname,
      status: updatedNode.status,
      lastSeenAt: updatedNode.lastSeenAt,
    };

    this.realtimeGateway.emitNodeStatusUpdate(statusPayload);
    await this.redisService.publish(
      PUBSUB_CHANNELS.NODES_STATUS_UPDATED,
      statusPayload,
    );

    return {
      acknowledged: true,
      nodeId: updatedNode.id,
      status: updatedNode.status,
      lastSeenAt: updatedNode.lastSeenAt,
    };
  }
}
