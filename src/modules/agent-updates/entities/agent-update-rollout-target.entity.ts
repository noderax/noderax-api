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
  AGENT_UPDATE_TARGET_STATUSES,
  AgentUpdateTargetStatus,
} from './agent-update-statuses';

@Entity({ name: 'agent_update_rollout_targets' })
export class AgentUpdateRolloutTargetEntity {
  @ApiProperty({
    format: 'uuid',
    example: 'c7f88611-b63e-4c95-9f37-4afb5c0cf275',
  })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({
    format: 'uuid',
  })
  @Index()
  @Column({ type: 'uuid' })
  rolloutId: string;

  @ApiProperty({
    format: 'uuid',
  })
  @Index()
  @Column({ type: 'uuid' })
  nodeId: string;

  @ApiProperty({
    format: 'uuid',
  })
  @Index()
  @Column({ type: 'uuid' })
  workspaceId: string;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true })
  teamId: string | null;

  @ApiProperty({
    example: 'srv-prod-01',
  })
  @Column({ length: 160 })
  nodeNameSnapshot: string;

  @ApiProperty({
    example: '1.0.0',
    nullable: true,
  })
  @Column({ length: 80, nullable: true })
  previousVersion: string | null;

  @ApiProperty({
    example: '1.0.1',
  })
  @Column({ length: 80 })
  targetVersion: string;

  @ApiProperty({
    enum: AGENT_UPDATE_TARGET_STATUSES,
    example: 'pending',
  })
  @Index()
  @Column({ length: 32, default: 'pending' })
  status: AgentUpdateTargetStatus;

  @ApiProperty({
    minimum: 0,
    maximum: 100,
    example: 0,
  })
  @Column({ type: 'integer', default: 0 })
  progressPercent: number;

  @ApiPropertyOptional({
    example: 'Waiting for the updated agent heartbeat.',
    nullable: true,
  })
  @Column({ type: 'text', nullable: true })
  statusMessage: string | null;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
  })
  @Index()
  @Column({ type: 'uuid', nullable: true })
  taskId: string | null;

  @ApiProperty({
    example: 0,
  })
  @Index()
  @Column({ type: 'integer', default: 0 })
  sequence: number;

  @ApiPropertyOptional({
    format: 'date-time',
    nullable: true,
  })
  @Column({ type: 'timestamptz', nullable: true })
  dispatchedAt: Date | null;

  @ApiPropertyOptional({
    format: 'date-time',
    nullable: true,
  })
  @Column({ type: 'timestamptz', nullable: true })
  completedAt: Date | null;

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
