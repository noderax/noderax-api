import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { TaskEntity } from './task.entity';
import { TaskLogLevel } from './task-log-level.enum';

@Index('IDX_task_logs_task_created_at', ['taskId', 'createdAt'])
@Entity({ name: 'task_logs' })
export class TaskLogEntity {
  @ApiProperty({
    format: 'uuid',
    example: '6af1d7df-43d5-4f30-97c3-f677918a2667',
  })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({
    format: 'uuid',
    example: 'ec9f97f2-7b56-4a7e-a7cb-5c957e9d32d8',
  })
  @Index()
  @Column({ type: 'uuid' })
  taskId: string;

  @ManyToOne(() => TaskEntity, (task) => task.logs, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'taskId' })
  task: TaskEntity;

  @ApiProperty({
    enum: TaskLogLevel,
    enumName: 'TaskLogLevel',
    example: TaskLogLevel.STDOUT,
  })
  @Column({
    type: 'enum',
    enum: TaskLogLevel,
    enumName: 'task_log_level_enum',
    default: TaskLogLevel.INFO,
  })
  level: TaskLogLevel;

  @ApiProperty({
    example: 'Pulling latest container image...',
  })
  @Column({ type: 'text' })
  message: string;

  @ApiProperty({
    format: 'date-time',
    example: '2026-03-17T12:41:30.000Z',
  })
  @Column({ type: 'timestamptz', nullable: true })
  timestamp: Date | null;

  @ApiProperty({
    format: 'date-time',
    example: '2026-03-17T12:41:30.000Z',
  })
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
