import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, timingSafeEqual } from 'crypto';
import { Repository } from 'typeorm';
import { PUBSUB_CHANNELS } from '../../common/constants/pubsub.constants';
import { SYSTEM_EVENT_TYPES } from '../../common/constants/system-event.constants';
import { AGENTS_CONFIG_KEY, agentsConfig } from '../../config';
import { RedisService } from '../../redis/redis.service';
import { EventSeverity } from '../events/entities/event-severity.enum';
import { EventsService } from '../events/events.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { CreateNodeDto } from './dto/create-node.dto';
import { QueryNodesDto } from './dto/query-nodes.dto';
import { NodeEntity } from './entities/node.entity';
import { NodeStatus } from './entities/node-status.enum';

@Injectable()
export class NodesService {
  private readonly logger = new Logger(NodesService.name);

  constructor(
    @InjectRepository(NodeEntity)
    private readonly nodesRepository: Repository<NodeEntity>,
    private readonly configService: ConfigService,
    private readonly eventsService: EventsService,
    private readonly realtimeGateway: RealtimeGateway,
    private readonly redisService: RedisService,
  ) {}

  async create(createNodeDto: CreateNodeDto): Promise<NodeEntity> {
    await this.assertHostnameAvailable(createNodeDto.hostname);

    const node = this.nodesRepository.create({
      name: createNodeDto.name ?? createNodeDto.hostname,
      description: createNodeDto.description ?? null,
      hostname: createNodeDto.hostname,
      os: createNodeDto.os,
      arch: createNodeDto.arch,
      status: NodeStatus.OFFLINE,
    });

    return this.nodesRepository.save(node);
  }

  async findAll(query: QueryNodesDto): Promise<NodeEntity[]> {
    const nodesQuery = this.nodesRepository
      .createQueryBuilder('node')
      .orderBy('node.createdAt', 'DESC')
      .take(query.limit ?? 50)
      .skip(query.offset ?? 0);

    if (query.status) {
      nodesQuery.andWhere('node.status = :status', { status: query.status });
    }

    if (query.search) {
      nodesQuery.andWhere(
        '(node.name ILIKE :search OR node.hostname ILIKE :search)',
        {
          search: `%${query.search}%`,
        },
      );
    }

    return nodesQuery.getMany();
  }

  async findOneOrFail(id: string): Promise<NodeEntity> {
    const node = await this.nodesRepository.findOne({
      where: { id },
    });

    if (!node) {
      throw new NotFoundException(`Node ${id} was not found`);
    }

    return node;
  }

  async delete(id: string): Promise<{ deleted: true; id: string }> {
    const node = await this.findOneOrFail(id);
    await this.nodesRepository.remove(node);

    return { deleted: true, id };
  }

  async ensureExists(nodeId: string): Promise<NodeEntity> {
    return this.findOneOrFail(nodeId);
  }

  async createFromEnrollment(input: {
    name: string;
    description: string | null;
    hostname: string;
    os: string;
    arch: string;
    agentTokenHash: string;
  }): Promise<NodeEntity> {
    await this.assertHostnameAvailable(input.hostname);

    const node = this.nodesRepository.create({
      name: input.name,
      description: input.description,
      hostname: input.hostname,
      os: input.os,
      arch: input.arch,
      status: NodeStatus.OFFLINE,
      lastSeenAt: null,
      agentTokenHash: input.agentTokenHash,
    });

    return this.nodesRepository.save(node);
  }

  async upsertFromAgentRegistration(input: {
    hostname: string;
    os: string;
    arch: string;
    agentTokenHash: string;
  }): Promise<NodeEntity> {
    const existingNode = await this.nodesRepository.findOne({
      where: { hostname: input.hostname },
    });

    const now = new Date();

    if (existingNode) {
      existingNode.os = input.os;
      existingNode.arch = input.arch;
      existingNode.status = NodeStatus.ONLINE;
      existingNode.lastSeenAt = now;
      existingNode.agentTokenHash = input.agentTokenHash;
      existingNode.name = existingNode.name || existingNode.hostname;

      return this.nodesRepository.save(existingNode);
    }

    const node = this.nodesRepository.create({
      name: input.hostname,
      hostname: input.hostname,
      os: input.os,
      arch: input.arch,
      status: NodeStatus.ONLINE,
      lastSeenAt: now,
      agentTokenHash: input.agentTokenHash,
    });

    return this.nodesRepository.save(node);
  }

  async authenticateAgent(
    nodeId: string,
    agentToken: string,
  ): Promise<NodeEntity> {
    const node = await this.nodesRepository
      .createQueryBuilder('node')
      .addSelect('node.agentTokenHash')
      .where('node.id = :nodeId', { nodeId })
      .getOne();

    if (!node) {
      throw new NotFoundException(`Node ${nodeId} was not found`);
    }

    if (!node.agentTokenHash) {
      throw new UnauthorizedException(
        'Agent token is not configured for this node',
      );
    }

    const providedHash = this.hashAgentToken(agentToken);
    const storedHash = node.agentTokenHash;

    // Constant-time comparison to prevent timing attacks
    const providedBuffer = Buffer.from(providedHash);
    const storedBuffer = Buffer.from(storedHash);

    if (
      providedBuffer.length !== storedBuffer.length ||
      !timingSafeEqual(providedBuffer, storedBuffer)
    ) {
      throw new UnauthorizedException('Invalid agent token');
    }

    return node;
  }

  async touchOnline(nodeId: string): Promise<NodeEntity> {
    const { node } = await this.markOnline(nodeId);
    return node;
  }

  async markOnline(
    nodeId: string,
  ): Promise<{ node: NodeEntity; transitionedToOnline: boolean }> {
    const now = new Date();
    const updateResult = await this.nodesRepository
      .createQueryBuilder()
      .update(NodeEntity)
      .set({
        status: NodeStatus.ONLINE,
        lastSeenAt: now,
        updatedAt: now,
      })
      .where('id = :nodeId', { nodeId })
      .andWhere('status = :status', { status: NodeStatus.OFFLINE })
      .execute();

    if (updateResult.affected) {
      return {
        node: await this.findOneOrFail(nodeId),
        transitionedToOnline: true,
      };
    }

    const node = await this.nodesRepository.findOne({ where: { id: nodeId } });

    if (!node) {
      throw new NotFoundException(`Node ${nodeId} was not found`);
    }

    node.status = NodeStatus.ONLINE;
    node.lastSeenAt = now;

    return {
      node: await this.nodesRepository.save(node),
      transitionedToOnline: false,
    };
  }

  async markOffline(
    nodeId: string,
  ): Promise<{ node: NodeEntity; transitionedToOffline: boolean }> {
    const now = new Date();
    const updateResult = await this.nodesRepository
      .createQueryBuilder()
      .update(NodeEntity)
      .set({
        status: NodeStatus.OFFLINE,
        updatedAt: now,
      })
      .where('id = :nodeId', { nodeId })
      .andWhere('status = :status', { status: NodeStatus.ONLINE })
      .execute();

    if (updateResult.affected) {
      return {
        node: await this.findOneOrFail(nodeId),
        transitionedToOffline: true,
      };
    }

    const node = await this.findOneOrFail(nodeId);
    if (node.status !== NodeStatus.OFFLINE) {
      node.status = NodeStatus.OFFLINE;
      node.updatedAt = now;
      return {
        node: await this.nodesRepository.save(node),
        transitionedToOffline: false,
      };
    }

    return {
      node,
      transitionedToOffline: false,
    };
  }

  async broadcastStatusUpdate(
    node: Pick<NodeEntity, 'id' | 'hostname' | 'status' | 'lastSeenAt'>,
  ): Promise<void> {
    const statusPayload = {
      nodeId: node.id,
      hostname: node.hostname,
      status: node.status,
      lastSeenAt: node.lastSeenAt,
    };

    this.realtimeGateway.emitNodeStatusUpdate(statusPayload);
    await this.redisService.publish(PUBSUB_CHANNELS.NODES_STATUS_UPDATED, {
      ...statusPayload,
      sourceInstanceId: this.redisService.getInstanceId(),
    });
  }

  async markStaleNodesOffline(): Promise<number> {
    const agents =
      this.configService.getOrThrow<ConfigType<typeof agentsConfig>>(
        AGENTS_CONFIG_KEY,
      );
    const cutoff = new Date(Date.now() - agents.heartbeatTimeoutSeconds * 1000);
    const updatedAt = new Date();

    const updateResult = await this.nodesRepository
      .createQueryBuilder()
      .update(NodeEntity)
      .set({
        status: NodeStatus.OFFLINE,
        updatedAt,
      })
      .where('status = :status', { status: NodeStatus.ONLINE })
      .andWhere('lastSeenAt < :cutoff', { cutoff })
      .returning(['id', 'name', 'hostname', 'status', 'lastSeenAt'])
      .execute();

    const offlineNodes = updateResult.raw as Array<
      Pick<NodeEntity, 'id' | 'name' | 'hostname' | 'status' | 'lastSeenAt'>
    >;

    if (!offlineNodes.length) {
      return 0;
    }

    for (const node of offlineNodes) {
      await this.eventsService.record({
        nodeId: node.id,
        type: SYSTEM_EVENT_TYPES.NODE_OFFLINE,
        severity: EventSeverity.WARNING,
        message: `Node ${this.getNodeLabel(node)} was marked offline after missing heartbeats for more than ${agents.heartbeatTimeoutSeconds} seconds`,
        metadata: {
          heartbeatTimeoutSeconds: agents.heartbeatTimeoutSeconds,
          lastSeenAt: this.formatTimestamp(node.lastSeenAt),
        },
      });
      await this.broadcastStatusUpdate(node);
    }

    this.logger.log(`Marked ${offlineNodes.length} stale node(s) offline`);

    return offlineNodes.length;
  }

  hashAgentToken(agentToken: string): string {
    return createHash('sha256').update(agentToken).digest('hex');
  }

  private async assertHostnameAvailable(hostname: string): Promise<void> {
    const existingNode = await this.nodesRepository.findOne({
      where: { hostname },
    });

    if (existingNode) {
      throw new ConflictException('A node with this hostname already exists');
    }
  }

  private getNodeLabel(node: Pick<NodeEntity, 'name' | 'hostname'>): string {
    if (!node.name || node.name === node.hostname) {
      return node.hostname;
    }

    return `${node.name} (${node.hostname})`;
  }

  private formatTimestamp(value: Date | string | null): string | null {
    if (!value) {
      return null;
    }

    return value instanceof Date ? value.toISOString() : value;
  }
}
