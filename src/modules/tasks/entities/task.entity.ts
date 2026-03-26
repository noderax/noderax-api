import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TaskLogEntity } from './task-log.entity';
import { TaskStatus } from './task-status.enum';

@Index('IDX_tasks_node_status_created_at', ['nodeId', 'status', 'createdAt'])
@Index('IDX_tasks_workspace_created_at', ['workspaceId', 'createdAt'])
@Entity({ name: 'tasks' })
export class TaskEntity {
  @ApiProperty({
    format: 'uuid',
    example: 'ec9f97f2-7b56-4a7e-a7cb-5c957e9d32d8',
  })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({
    format: 'uuid',
    example: '9d4174b9-5dc2-4891-8d1b-f0a2f6c4e52c',
  })
  @Index()
  @Column({ type: 'uuid' })
  workspaceId: string;

  @ApiProperty({
    format: 'uuid',
    example: 'b7f88611-b63e-4c95-9f37-4afb5c0cf275',
  })
  @Index()
  @Column({ type: 'uuid' })
  nodeId: string;

  @ApiProperty({
    example: 'shell.exec',
  })
  @Column({ length: 120 })
  type: string;

  @ApiProperty({
    example: {
      command: 'docker ps',
    },
    type: 'object',
    additionalProperties: true,
  })
  @Column({ type: 'jsonb', default: {} })
  payload: Record<string, unknown>;

  @ApiProperty({
    enum: TaskStatus,
    enumName: 'TaskStatus',
    example: TaskStatus.QUEUED,
  })
  @Column({
    type: 'enum',
    enum: TaskStatus,
    enumName: 'task_status_enum',
    default: TaskStatus.QUEUED,
  })
  status: TaskStatus;

  @ApiPropertyOptional({
    example: {
      exitCode: 0,
      containers: 3,
    },
    type: 'object',
    additionalProperties: true,
    nullable: true,
  })
  @Column({ type: 'jsonb', nullable: true })
  result: Record<string, unknown> | null;

  @ApiPropertyOptional({
    example: 'Container check completed successfully',
    nullable: true,
  })
  @Column({ type: 'text', nullable: true })
  output: string | null;

  @ApiPropertyOptional({
    example: false,
    nullable: true,
    description: 'True when task output was truncated to satisfy API limits.',
  })
  @Column({ type: 'boolean', nullable: true, default: false })
  outputTruncated: boolean | null;

  @ApiPropertyOptional({
    format: 'date-time',
    example: '2026-03-22T16:47:40.000Z',
    nullable: true,
    description:
      'Lease expiry used by polling agents to avoid duplicate claims.',
  })
  @Column({ type: 'timestamptz', nullable: true })
  leaseUntil: Date | null;

  @ApiPropertyOptional({
    format: 'uuid',
    example: 'b7f88611-b63e-4c95-9f37-4afb5c0cf275',
    nullable: true,
    description: 'Node ID that currently holds the lease for this task.',
  })
  @Column({ type: 'uuid', nullable: true })
  claimedBy: string | null;

  @ApiPropertyOptional({
    format: 'uuid',
    example: '71cb6cc7-2cc9-4235-a8ef-b6c2d8d92d23',
    nullable: true,
    description: 'Opaque claim token for optimistic ownership checks.',
  })
  @Column({ type: 'uuid', nullable: true })
  claimToken: string | null;

  @ApiPropertyOptional({
    format: 'date-time',
    example: '2026-03-17T12:41:00.000Z',
    nullable: true,
  })
  @Column({ type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @ApiPropertyOptional({
    format: 'date-time',
    example: '2026-03-17T12:42:00.000Z',
    nullable: true,
  })
  @Column({ type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  @ApiPropertyOptional({
    format: 'date-time',
    example: '2026-03-17T12:41:30.000Z',
    nullable: true,
    description:
      'Operator requested cancellation timestamp. Running agents should stop gracefully when this is set.',
  })
  @Column({ type: 'timestamptz', nullable: true })
  cancelRequestedAt: Date | null;

  @ApiPropertyOptional({
    example: 'Stopped by operator from dashboard',
    nullable: true,
  })
  @Column({ type: 'text', nullable: true })
  cancelReason: string | null;

  @ApiProperty({
    format: 'date-time',
    example: '2026-03-17T12:40:00.000Z',
  })
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @ApiProperty({
    format: 'date-time',
    example: '2026-03-17T12:41:00.000Z',
  })
  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @ApiPropertyOptional({
    type: () => TaskLogEntity,
    isArray: true,
  })
  @OneToMany(() => TaskLogEntity, (taskLog) => taskLog.task)
  logs?: TaskLogEntity[];
}
