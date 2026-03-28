import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { NodeEntity } from '../nodes/entities/node.entity';
import { TeamEntity } from '../workspaces/entities/team.entity';
import { FleetNodeDto } from './dto/fleet-node.dto';
import { QueryFleetNodesDto } from './dto/query-fleet-nodes.dto';

@Injectable()
export class FleetService {
  constructor(
    @InjectRepository(NodeEntity)
    private readonly nodesRepository: Repository<NodeEntity>,
    @InjectRepository(TeamEntity)
    private readonly teamsRepository: Repository<TeamEntity>,
  ) {}

  async listFleetNodes(query: QueryFleetNodesDto): Promise<FleetNodeDto[]> {
    const builder = this.nodesRepository
      .createQueryBuilder('node')
      .orderBy('node.updatedAt', 'DESC');

    if (query.workspaceId) {
      builder.andWhere('node.workspaceId = :workspaceId', {
        workspaceId: query.workspaceId,
      });
    }

    if (query.teamId) {
      builder.andWhere('node.teamId = :teamId', { teamId: query.teamId });
    }

    if (query.status) {
      builder.andWhere('node.status = :status', { status: query.status });
    }

    if (typeof query.maintenanceMode === 'boolean') {
      builder.andWhere('node.maintenanceMode = :maintenanceMode', {
        maintenanceMode: query.maintenanceMode,
      });
    }

    const nodes = await builder.getMany();
    const teamLookup = await this.buildTeamNameLookup(nodes);

    return nodes.map((node) => this.mapFleetNode(node, teamLookup));
  }

  private classifyPlatform(os: string): 'linux' | 'darwin' {
    const normalized = os.trim().toLowerCase();
    return normalized.includes('darwin') || normalized.includes('mac')
      ? 'darwin'
      : 'linux';
  }

  private async buildTeamNameLookup(nodes: NodeEntity[]) {
    const teamIds = Array.from(
      new Set(
        nodes
          .map((node) => node.teamId)
          .filter((teamId): teamId is string => Boolean(teamId)),
      ),
    );

    if (!teamIds.length) {
      return new Map<string, string>();
    }

    const teams = await this.teamsRepository.find({
      where: {
        id: In(teamIds),
      },
    });

    return new Map(teams.map((team) => [team.id, team.name] as const));
  }

  private mapFleetNode(
    node: NodeEntity,
    teamLookup: Map<string, string>,
  ): FleetNodeDto {
    return {
      id: node.id,
      workspaceId: node.workspaceId,
      name: node.name,
      hostname: node.hostname,
      os: node.os,
      arch: node.arch,
      status: node.status,
      teamId: node.teamId ?? null,
      teamName: node.teamId ? teamLookup.get(node.teamId) ?? null : null,
      maintenanceMode: node.maintenanceMode,
      maintenanceReason: node.maintenanceReason,
      agentVersion: node.agentVersion ?? null,
      platformVersion: node.platformVersion ?? null,
      kernelVersion: node.kernelVersion ?? null,
      lastVersionReportedAt: node.lastVersionReportedAt ?? null,
      platformFamily: this.classifyPlatform(node.os),
    };
  }
}
