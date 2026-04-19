import { ApiProperty } from '@nestjs/swagger';

export class DependencyCheckActionDto {
  @ApiProperty({ example: 'requeue' })
  id: string;

  @ApiProperty({ example: 'Requeue failed events' })
  label: string;
}

export class OutboxDeadLetterPreviewDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'event.created' })
  type: string;

  @ApiProperty({ example: 8 })
  attempts: number;

  @ApiProperty({
    example:
      'Event notification delivery failed for event ...: Email delivery failed.',
    nullable: true,
  })
  lastError: string | null;

  @ApiProperty({ format: 'date-time' })
  updatedAt: string;
}

export class OutboxDependencyMetaDto {
  @ApiProperty({ example: 0 })
  backlogCount: number;

  @ApiProperty({ example: 0 })
  dueCount: number;

  @ApiProperty({ example: 0 })
  failedCount: number;

  @ApiProperty({ example: 2 })
  deadLetterCount: number;

  @ApiProperty({
    type: () => OutboxDeadLetterPreviewDto,
    isArray: true,
  })
  deadLetters: OutboxDeadLetterPreviewDto[];

  @ApiProperty({
    type: () => DependencyCheckActionDto,
    isArray: true,
  })
  actions: DependencyCheckActionDto[];
}

export class DependencyCheckDto {
  @ApiProperty({ example: true })
  healthy: boolean;

  @ApiProperty({ example: 'ready' })
  status: string;

  @ApiProperty({ example: null, nullable: true })
  detail: string | null;

  @ApiProperty({
    type: 'object',
    nullable: true,
    required: false,
    additionalProperties: true,
  })
  meta?: Record<string, unknown> | null;
}

export class DependencyHealthChecksDto {
  @ApiProperty({ type: () => DependencyCheckDto })
  database: DependencyCheckDto;

  @ApiProperty({ type: () => DependencyCheckDto })
  redis: DependencyCheckDto;

  @ApiProperty({ type: () => DependencyCheckDto })
  installState: DependencyCheckDto;

  @ApiProperty({ type: () => DependencyCheckDto })
  migrations: DependencyCheckDto;

  @ApiProperty({ type: () => DependencyCheckDto })
  clusterLocks: DependencyCheckDto;

  @ApiProperty({ type: () => DependencyCheckDto })
  outbox: DependencyCheckDto;
}

export class DependencyHealthResponseDto {
  @ApiProperty({ example: 'noderax-api' })
  service: string;

  @ApiProperty({ example: 'ok' })
  status: string;

  @ApiProperty({ format: 'date-time' })
  timestamp: string;

  @ApiProperty({ type: () => DependencyHealthChecksDto })
  checks: DependencyHealthChecksDto;
}

export class ReadinessResponseDto extends DependencyHealthResponseDto {
  @ApiProperty({ example: true })
  ready: boolean;
}
