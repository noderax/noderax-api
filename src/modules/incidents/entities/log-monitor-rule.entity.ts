import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  LOG_MONITOR_CADENCES,
  LogMonitorCadence,
} from './log-monitor-cadence.enum';

@Index('IDX_log_monitor_rules_workspace_node', ['workspaceId', 'nodeId'])
@Index('IDX_log_monitor_rules_enabled_next_run', ['enabled', 'nextRunAt'])
@Entity({ name: 'log_monitor_rules' })
export class LogMonitorRuleEntity {
  @ApiProperty({
    format: 'uuid',
    example: 'f7a0d47a-2944-4d6d-9216-bfcbc7be4f1a',
  })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({
    format: 'uuid',
  })
  @Column({ type: 'uuid' })
  workspaceId: string;

  @ApiProperty({
    format: 'uuid',
  })
  @Column({ type: 'uuid' })
  nodeId: string;

  @ApiProperty({
    example: 'Detect repeated SSH authentication failures',
  })
  @Column({ length: 160 })
  name: string;

  @ApiProperty({
    example: true,
  })
  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @ApiProperty({
    example: 'auth.log',
  })
  @Column({ length: 64 })
  sourcePresetId: string;

  @ApiProperty({
    enum: LOG_MONITOR_CADENCES,
    example: 'minutely',
  })
  @Column({ length: 24, default: 'minutely' })
  cadence: LogMonitorCadence;

  @ApiProperty({
    minimum: 1,
    maximum: 60,
    example: 1,
  })
  @Column({ type: 'smallint', default: 1 })
  intervalMinutes: number;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
  })
  @Column({ type: 'jsonb' })
  dsl: Record<string, unknown>;

  @ApiPropertyOptional({
    format: 'date-time',
    nullable: true,
  })
  @Column({ type: 'timestamptz', nullable: true })
  nextRunAt: Date | null;

  @ApiPropertyOptional({
    format: 'date-time',
    nullable: true,
  })
  @Column({ type: 'timestamptz', nullable: true })
  lastRunAt: Date | null;

  @ApiPropertyOptional({
    nullable: true,
  })
  @Column({ type: 'text', nullable: true })
  lastError: string | null;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true })
  lastTaskId: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  leaseUntil: Date | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  claimedBy: string | null;

  @Column({ type: 'uuid', nullable: true })
  claimToken: string | null;

  @ApiProperty({
    format: 'date-time',
  })
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @ApiProperty({
    format: 'date-time',
  })
  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
