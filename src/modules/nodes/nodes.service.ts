import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { In, LessThan, Repository } from 'typeorm';
import { agentsConfig } from '../../config';
import { CreateNodeDto } from './dto/create-node.dto';
import { QueryNodesDto } from './dto/query-nodes.dto';
import { NodeEntity } from './entities/node.entity';
import { NodeStatus } from './entities/node-status.enum';

@Injectable()
export class NodesService {
  constructor(
    @InjectRepository(NodeEntity)
    private readonly nodesRepository: Repository<NodeEntity>,
    private readonly configService: ConfigService,
  ) {}

  async create(createNodeDto: CreateNodeDto) {
    const existingNode = await this.nodesRepository.findOne({
      where: { hostname: createNodeDto.hostname },
    });

    if (existingNode) {
      throw new ConflictException('A node with this hostname already exists');
    }

    const node = this.nodesRepository.create({
      name: createNodeDto.name ?? createNodeDto.hostname,
      hostname: createNodeDto.hostname,
      os: createNodeDto.os,
      arch: createNodeDto.arch,
      status: NodeStatus.OFFLINE,
    });

    return this.nodesRepository.save(node);
  }

  async findAll(query: QueryNodesDto) {
    await this.refreshStaleNodes();

    const nodesQuery = this.nodesRepository
      .createQueryBuilder('node')
      .orderBy('node.createdAt', 'DESC');

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

  async findOneOrFail(id: string) {
    await this.refreshStaleNodes();

    const node = await this.nodesRepository.findOne({
      where: { id },
    });

    if (!node) {
      throw new NotFoundException(`Node ${id} was not found`);
    }

    return node;
  }

  async delete(id: string) {
    const node = await this.findOneOrFail(id);
    await this.nodesRepository.remove(node);

    return { deleted: true, id };
  }

  async ensureExists(nodeId: string) {
    return this.findOneOrFail(nodeId);
  }

  async upsertFromAgentRegistration(input: {
    hostname: string;
    os: string;
    arch: string;
    agentTokenHash: string;
  }) {
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

  async authenticateAgent(nodeId: string, agentToken: string) {
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

    if (node.agentTokenHash !== this.hashAgentToken(agentToken)) {
      throw new UnauthorizedException('Invalid agent token');
    }

    return node;
  }

  async touchOnline(nodeId: string) {
    const node = await this.nodesRepository.findOne({ where: { id: nodeId } });

    if (!node) {
      throw new NotFoundException(`Node ${nodeId} was not found`);
    }

    node.status = NodeStatus.ONLINE;
    node.lastSeenAt = new Date();

    return this.nodesRepository.save(node);
  }

  hashAgentToken(agentToken: string) {
    return createHash('sha256').update(agentToken).digest('hex');
  }

  private async refreshStaleNodes() {
    const agents = this.configService.getOrThrow<
      ConfigType<typeof agentsConfig>
    >(agentsConfig.KEY);
    const cutoff = new Date(Date.now() - agents.heartbeatTimeoutSeconds * 1000);

    const staleNodes = await this.nodesRepository.find({
      where: {
        status: NodeStatus.ONLINE,
        lastSeenAt: LessThan(cutoff),
      },
    });

    if (!staleNodes.length) {
      return;
    }

    await this.nodesRepository.update(
      { id: In(staleNodes.map((node) => node.id)) },
      { status: NodeStatus.OFFLINE },
    );
  }
}
