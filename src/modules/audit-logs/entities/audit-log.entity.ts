import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Index('IDX_audit_logs_scope_created_at', ['scope', 'createdAt'])
@Index('IDX_audit_logs_workspace_created_at', ['workspaceId', 'createdAt'])
@Entity({ name: 'audit_logs' })
export class AuditLogEntity {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ enum: ['platform', 'workspace'] })
  @Column({ length: 24 })
  scope: 'platform' | 'workspace';

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @Column({ type: 'uuid', nullable: true })
  workspaceId: string | null;

  @ApiProperty({ enum: ['user', 'system'] })
  @Column({ length: 24, default: 'user' })
  actorType: 'user' | 'system';

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @Column({ type: 'uuid', nullable: true })
  actorUserId: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ length: 255, nullable: true })
  actorEmailSnapshot: string | null;

  @ApiProperty()
  @Column({ length: 120 })
  action: string;

  @ApiProperty()
  @Column({ length: 80 })
  targetType: string;

  @ApiPropertyOptional({ nullable: true })
  @Column({ length: 120, nullable: true })
  targetId: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ length: 255, nullable: true })
  targetLabel: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ length: 120, nullable: true })
  ipAddress: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'text', nullable: true })
  userAgent: string | null;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
  })
  @Column({ type: 'jsonb', nullable: true })
  changes: Record<string, unknown> | null;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
  })
  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @ApiProperty({ format: 'date-time' })
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
