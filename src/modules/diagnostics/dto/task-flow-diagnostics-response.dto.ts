import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class AgentCountersDto {
  @ApiProperty({ example: 12345 })
  'metrics.ingested': number;

  @ApiProperty({ example: 87 })
  'connection.opened': number;
}

class ClaimCountersDto {
  @ApiProperty({ example: 340 })
  'task.claim.attempted': number;

  @ApiProperty({ example: 320 })
  'task.claim.succeeded': number;

  @ApiProperty({ example: 20 })
  'task.claim.failed': number;

  @ApiProperty({ example: 140 })
  'task.claim.emptyPoll': number;
}

class QueueSnapshotDto {
  @ApiProperty({ example: 12 })
  queued: number;

  @ApiProperty({ example: 5 })
  running: number;
}

class HealthSnapshotDto {
  @ApiProperty({ example: true })
  realtimeConnected: boolean;

  @ApiPropertyOptional({
    nullable: true,
    format: 'date-time',
    example: '2026-03-23T12:34:50.000Z',
  })
  lastAgentSeenAt: string | null;

  @ApiPropertyOptional({
    nullable: true,
    format: 'date-time',
    example: '2026-03-23T12:34:49.000Z',
  })
  lastClaimAt: string | null;
}

export class TaskFlowDiagnosticsResponseDto {
  @ApiProperty({
    format: 'date-time',
    example: '2026-03-23T12:34:56.000Z',
  })
  fetchedAt: string;

  @ApiProperty({
    example: 'agent-task-flow',
  })
  source: string;

  @ApiProperty({
    type: AgentCountersDto,
  })
  agentCounters: AgentCountersDto;

  @ApiProperty({
    type: ClaimCountersDto,
  })
  claimCounters: ClaimCountersDto;

  @ApiProperty({
    type: QueueSnapshotDto,
  })
  queue: QueueSnapshotDto;

  @ApiProperty({
    type: HealthSnapshotDto,
  })
  health: HealthSnapshotDto;
}
