import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { SYSTEM_EVENT_TYPES } from '../../common/constants/system-event.constants';
import { AGENTS_CONFIG_KEY, agentsConfig } from '../../config';
import { EventSeverity } from '../events/entities/event-severity.enum';
import { EventsService } from '../events/events.service';
import { NodesService } from '../nodes/nodes.service';
import { AgentHeartbeatResponseDto } from './dto/agent-heartbeat-response.dto';
import { AgentHeartbeatDto } from './dto/agent-heartbeat.dto';
import { AgentRegisterResponseDto } from './dto/agent-register-response.dto';
import { AgentRegisterDto } from './dto/agent-register.dto';

@Injectable()
export class AgentsService {
  constructor(
    private readonly nodesService: NodesService,
    private readonly eventsService: EventsService,
    private readonly configService: ConfigService,
  ) {}

  async register(
    agentRegisterDto: AgentRegisterDto,
  ): Promise<AgentRegisterResponseDto> {
    const agents =
      this.configService.getOrThrow<ConfigType<typeof agentsConfig>>(
        AGENTS_CONFIG_KEY,
      );

    if (
      agents.enrollmentToken &&
      agentRegisterDto.enrollmentToken !== agents.enrollmentToken
    ) {
      throw new ForbiddenException('Invalid enrollment token');
    }

    const os = this.resolveRequiredRegistrationField(
      [
        agentRegisterDto.os,
        agentRegisterDto.operatingSystem,
        agentRegisterDto.platform,
      ],
      'os',
    );
    const arch = this.resolveRequiredRegistrationField(
      [agentRegisterDto.arch, agentRegisterDto.architecture],
      'arch',
    );

    const agentToken = randomBytes(32).toString('hex');
    const agentTokenHash = this.nodesService.hashAgentToken(agentToken);

    const node = await this.nodesService.upsertFromAgentRegistration({
      hostname: agentRegisterDto.hostname,
      os,
      arch,
      agentTokenHash,
      agentVersion: agentRegisterDto.agentVersion ?? null,
      platformVersion: agentRegisterDto.platformVersion ?? null,
      kernelVersion: agentRegisterDto.kernelVersion ?? null,
    });

    await this.eventsService.record({
      nodeId: node.id,
      type: SYSTEM_EVENT_TYPES.NODE_REGISTERED,
      severity: EventSeverity.INFO,
      message: `Node ${node.hostname} registered with the control plane`,
    });
    await this.nodesService.broadcastStatusUpdate(node);

    return {
      nodeId: node.id,
      agentToken,
    };
  }

  private resolveRequiredRegistrationField(
    candidates: Array<string | undefined>,
    fieldName: string,
  ): string {
    const value = candidates.find(
      (candidate) =>
        typeof candidate === 'string' && candidate.trim().length > 0,
    );

    if (!value) {
      throw new BadRequestException(`${fieldName} is required`);
    }

    return value.trim();
  }

  async heartbeat(
    agentHeartbeatDto: AgentHeartbeatDto,
  ): Promise<AgentHeartbeatResponseDto> {
    const node = await this.nodesService.authenticateAgent(
      agentHeartbeatDto.nodeId,
      agentHeartbeatDto.agentToken,
    );
    const { node: updatedNode, transitionedToOnline } =
      await this.nodesService.markOnline(node.id, {
        agentVersion: agentHeartbeatDto.agentVersion ?? null,
        platformVersion: agentHeartbeatDto.platformVersion ?? null,
        kernelVersion: agentHeartbeatDto.kernelVersion ?? null,
      });

    if (transitionedToOnline) {
      await this.eventsService.record({
        nodeId: updatedNode.id,
        type: SYSTEM_EVENT_TYPES.NODE_ONLINE,
        severity: EventSeverity.INFO,
        message: `Node ${updatedNode.hostname} is back online`,
      });
    }
    await this.nodesService.broadcastStatusUpdate(updatedNode);

    return {
      acknowledged: true,
      nodeId: updatedNode.id,
      status: updatedNode.status,
      lastSeenAt: updatedNode.lastSeenAt,
    };
  }
}
