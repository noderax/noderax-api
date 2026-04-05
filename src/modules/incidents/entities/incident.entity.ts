import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { EventSeverity } from '../../events/entities/event-severity.enum';
import { IncidentAnalysisEntity } from './incident-analysis.entity';
import type { IncidentStatus as IncidentStatusValue } from './incident-status.enum';

@Index('IDX_incidents_workspace_status_last_seen', [
  'workspaceId',
  'status',
  'lastSeenAt',
])
@Index('IDX_incidents_node_rule_fingerprint_status', [
  'nodeId',
  'ruleId',
  'fingerprint',
  'status',
])
@Entity({ name: 'incidents' })
export class IncidentEntity {
  @ApiProperty({
    format: 'uuid',
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
    format: 'uuid',
  })
  @Column({ type: 'uuid' })
  ruleId: string;

  @ApiProperty({
    example: 'auth.log',
  })
  @Column({ length: 64 })
  sourcePresetId: string;

  @ApiProperty({
    example: 'open',
  })
  @Column({ length: 24, default: 'open' })
  status: IncidentStatusValue;

  @ApiProperty({
    enum: EventSeverity,
    enumName: 'EventSeverity',
    example: EventSeverity.WARNING,
  })
  @Column({
    type: 'enum',
    enum: EventSeverity,
    enumName: 'incident_severity_enum',
    default: EventSeverity.WARNING,
  })
  severity: EventSeverity;

  @ApiProperty({
    example: 'Repeated SSH authentication failures',
  })
  @Column({ length: 255 })
  title: string;

  @ApiProperty({
    example: 'auth.log:ssh:invalid-user',
  })
  @Column({ length: 255 })
  fingerprint: string;

  @ApiProperty({
    format: 'date-time',
  })
  @Column({ type: 'timestamptz' })
  firstSeenAt: Date;

  @ApiProperty({
    format: 'date-time',
  })
  @Column({ type: 'timestamptz' })
  lastSeenAt: Date;

  @ApiProperty({
    example: 5,
  })
  @Column({ type: 'integer', default: 1 })
  hitCount: number;

  @ApiPropertyOptional({
    type: 'object',
    nullable: true,
    additionalProperties: true,
  })
  @Column({ type: 'jsonb', nullable: true })
  latestSample: Record<string, unknown> | null;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true })
  latestTaskId: string | null;

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

  @ApiPropertyOptional({
    type: () => IncidentAnalysisEntity,
    nullable: true,
  })
  latestAnalysis?: IncidentAnalysisEntity | null;
}
