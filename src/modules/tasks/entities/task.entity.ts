import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TaskStatus } from './task-status.enum';

@Index('IDX_tasks_node_status_created_at', ['nodeId', 'status', 'createdAt'])
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
}
