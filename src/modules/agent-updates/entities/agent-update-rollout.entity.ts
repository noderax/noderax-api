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
  AGENT_UPDATE_ROLLOUT_STATUSES,
  AgentUpdateRolloutStatus,
} from './agent-update-statuses';

@Entity({ name: 'agent_update_rollouts' })
export class AgentUpdateRolloutEntity {
  @ApiProperty({
    format: 'uuid',
    example: 'b7f88611-b63e-4c95-9f37-4afb5c0cf275',
  })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({
    example: '1.0.1',
  })
  @Index()
  @Column({ length: 80 })
  targetVersion: string;

  @ApiProperty({
    enum: AGENT_UPDATE_ROLLOUT_STATUSES,
    example: 'running',
  })
  @Index()
  @Column({ length: 32, default: 'queued' })
  status: AgentUpdateRolloutStatus;

  @ApiProperty({
    example: false,
  })
  @Column({ type: 'boolean', default: false })
  rollback: boolean;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true })
  requestedByUserId: string | null;

  @ApiPropertyOptional({
    example: 'admin@example.com',
    nullable: true,
  })
  @Column({ length: 255, nullable: true })
  requestedByEmailSnapshot: string | null;

  @ApiPropertyOptional({
    format: 'date-time',
    nullable: true,
  })
  @Column({ type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @ApiPropertyOptional({
    format: 'date-time',
    nullable: true,
  })
  @Column({ type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @ApiPropertyOptional({
    format: 'date-time',
    nullable: true,
  })
  @Column({ type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;

  @ApiPropertyOptional({
    example: 'Paused after srv-02 failed checksum verification.',
    nullable: true,
  })
  @Column({ type: 'text', nullable: true })
  statusMessage: string | null;

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
