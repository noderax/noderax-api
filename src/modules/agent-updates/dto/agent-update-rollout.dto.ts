import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AgentReleaseDto } from './agent-release.dto';
import {
  AGENT_UPDATE_ROLLOUT_STATUSES,
  AGENT_UPDATE_TARGET_STATUSES,
} from '../entities/agent-update-statuses';

export class AgentUpdateRolloutTargetDto {
  @ApiProperty({
    format: 'uuid',
  })
  id: string;

  @ApiProperty({
    format: 'uuid',
  })
  rolloutId: string;

  @ApiProperty({
    format: 'uuid',
  })
  nodeId: string;

  @ApiProperty({
    format: 'uuid',
  })
  workspaceId: string;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
  })
  teamId: string | null;

  @ApiProperty({
    example: 'srv-prod-01',
  })
  nodeNameSnapshot: string;

  @ApiPropertyOptional({
    example: '1.0.0',
    nullable: true,
  })
  previousVersion: string | null;

  @ApiProperty({
    example: '1.0.1',
  })
  targetVersion: string;

  @ApiProperty({
    enum: AGENT_UPDATE_TARGET_STATUSES,
    example: 'installing',
  })
  status: (typeof AGENT_UPDATE_TARGET_STATUSES)[number];

  @ApiProperty({
    minimum: 0,
    maximum: 100,
    example: 70,
  })
  progressPercent: number;

  @ApiPropertyOptional({
    nullable: true,
    example: 'Replacing the managed noderax-agent binary.',
  })
  statusMessage: string | null;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
  })
  taskId: string | null;

  @ApiProperty({
    example: 0,
  })
  sequence: number;

  @ApiPropertyOptional({
    format: 'date-time',
    nullable: true,
  })
  dispatchedAt: string | null;

  @ApiPropertyOptional({
    format: 'date-time',
    nullable: true,
  })
  completedAt: string | null;

  @ApiProperty({
    format: 'date-time',
  })
  createdAt: string;

  @ApiProperty({
    format: 'date-time',
  })
  updatedAt: string;
}

export class AgentUpdateRolloutCountsDto {
  @ApiProperty({
    example: 10,
  })
  total: number;

  @ApiProperty({
    example: 4,
  })
  completed: number;

  @ApiProperty({
    example: 1,
  })
  failed: number;

  @ApiProperty({
    example: 1,
  })
  skipped: number;

  @ApiProperty({
    example: 1,
  })
  active: number;

  @ApiProperty({
    example: 3,
  })
  pending: number;
}

export class AgentUpdateRolloutDto {
  @ApiProperty({
    format: 'uuid',
  })
  id: string;

  @ApiProperty({
    example: '1.0.1',
  })
  targetVersion: string;

  @ApiProperty({
    enum: AGENT_UPDATE_ROLLOUT_STATUSES,
    example: 'running',
  })
  status: (typeof AGENT_UPDATE_ROLLOUT_STATUSES)[number];

  @ApiProperty({
    example: false,
  })
  rollback: boolean;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
  })
  requestedByUserId: string | null;

  @ApiPropertyOptional({
    nullable: true,
    example: 'admin@example.com',
  })
  requestedByEmailSnapshot: string | null;

  @ApiPropertyOptional({
    nullable: true,
    example: 'Paused after srv-02 failed checksum verification.',
  })
  statusMessage: string | null;

  @ApiPropertyOptional({
    format: 'date-time',
    nullable: true,
  })
  startedAt: string | null;

  @ApiPropertyOptional({
    format: 'date-time',
    nullable: true,
  })
  completedAt: string | null;

  @ApiPropertyOptional({
    format: 'date-time',
    nullable: true,
  })
  cancelledAt: string | null;

  @ApiProperty({
    type: AgentUpdateRolloutCountsDto,
  })
  counts: AgentUpdateRolloutCountsDto;

  @ApiProperty({
    type: AgentUpdateRolloutTargetDto,
    isArray: true,
  })
  targets: AgentUpdateRolloutTargetDto[];

  @ApiProperty({
    format: 'date-time',
  })
  createdAt: string;

  @ApiProperty({
    format: 'date-time',
  })
  updatedAt: string;
}

export class AgentUpdateSummaryDto {
  @ApiPropertyOptional({
    nullable: true,
    type: AgentReleaseDto,
  })
  latestRelease: AgentReleaseDto | null;

  @ApiProperty({
    example: 12,
  })
  outdatedNodeCount: number;

  @ApiProperty({
    example: 8,
  })
  eligibleOutdatedNodeCount: number;

  @ApiPropertyOptional({
    nullable: true,
    type: AgentUpdateRolloutDto,
  })
  activeRollout: AgentUpdateRolloutDto | null;

  @ApiPropertyOptional({
    format: 'date-time',
    nullable: true,
  })
  releaseCheckedAt: string | null;
}
