import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { NodeEntity } from '../../nodes/entities/node.entity';
import { UserEntity } from '../../users/entities/user.entity';
import {
  SCHEDULED_TASK_CADENCES,
  ScheduledTaskCadence,
  SCHEDULED_TASK_TIMEZONE,
} from '../scheduled-task.utils';

@Index('IDX_scheduled_tasks_enabled_next_run', ['enabled', 'nextRunAt'])
@Index('IDX_scheduled_tasks_node_enabled_next_run', [
  'nodeId',
  'enabled',
  'nextRunAt',
])
@Index('IDX_scheduled_tasks_owner_user', ['ownerUserId'])
@Entity({ name: 'scheduled_tasks' })
export class ScheduledTaskEntity {
  @ApiProperty({
    format: 'uuid',
    example: 'b6c8b6be-e54d-46d7-816c-9732cf5efe7d',
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
  @Column({ type: 'uuid' })
  nodeId: string;

  @ManyToOne(() => NodeEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'nodeId' })
  node?: NodeEntity;

  @ApiPropertyOptional({
    format: 'uuid',
    example: '4d2d2219-5d3e-4761-a79b-3c09ae88d6d3',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true })
  ownerUserId: string | null;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'ownerUserId' })
  owner?: UserEntity | null;

  @ApiPropertyOptional({
    example: 'Noderax Admin',
    nullable: true,
  })
  ownerName?: string | null;

  @ApiProperty({
    example: false,
  })
  isLegacy: boolean;

  @ApiProperty({
    example: 'Daily hostname check',
  })
  @Column({ length: 160 })
  name: string;

  @ApiProperty({
    example: 'hostname',
  })
  @Column({ type: 'text' })
  command: string;

  @ApiProperty({
    enum: SCHEDULED_TASK_CADENCES,
    example: 'daily',
  })
  @Column({ length: 24 })
  cadence: ScheduledTaskCadence;

  @ApiProperty({
    example: 15,
    minimum: 0,
    maximum: 59,
  })
  @Column({ type: 'smallint' })
  minute: number;

  @ApiPropertyOptional({
    example: 3,
    minimum: 0,
    maximum: 23,
    nullable: true,
  })
  @Column({ type: 'smallint', nullable: true })
  hour: number | null;

  @ApiPropertyOptional({
    example: 1,
    minimum: 0,
    maximum: 6,
    nullable: true,
  })
  @Column({ type: 'smallint', nullable: true })
  dayOfWeek: number | null;

  @ApiPropertyOptional({
    example: 5,
    minimum: 1,
    maximum: 10080,
    nullable: true,
  })
  @Column({ type: 'smallint', nullable: true })
  intervalMinutes: number | null;

  @ApiProperty({
    example: SCHEDULED_TASK_TIMEZONE,
  })
  @Column({ length: 80, default: SCHEDULED_TASK_TIMEZONE })
  timezone: string;

  @ApiProperty({
    enum: ['workspace', 'legacy_fixed'],
    example: 'workspace',
  })
  @Column({
    type: 'enum',
    enumName: 'scheduled_task_timezone_source_enum',
    enum: ['workspace', 'legacy_fixed'],
    default: 'legacy_fixed',
  })
  timezoneSource: 'workspace' | 'legacy_fixed';

  @ApiProperty({
    example: true,
  })
  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @ApiPropertyOptional({
    format: 'date-time',
    example: '2026-03-27T08:00:00.000Z',
    nullable: true,
  })
  @Column({ type: 'timestamptz', nullable: true })
  nextRunAt: Date | null;

  @ApiPropertyOptional({
    format: 'date-time',
    example: '2026-03-26T08:00:00.000Z',
    nullable: true,
  })
  @Column({ type: 'timestamptz', nullable: true })
  lastRunAt: Date | null;

  @ApiPropertyOptional({
    format: 'uuid',
    example: 'ec9f97f2-7b56-4a7e-a7cb-5c957e9d32d8',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true })
  lastRunTaskId: string | null;

  @ApiPropertyOptional({
    example: 'Node was not found',
    nullable: true,
  })
  @Column({ type: 'text', nullable: true })
  lastError: string | null;

  @ApiPropertyOptional({
    format: 'date-time',
    example: '2026-03-26T08:00:10.000Z',
    nullable: true,
  })
  @Column({ type: 'timestamptz', nullable: true })
  leaseUntil: Date | null;

  @ApiPropertyOptional({
    example: 'api-1-1a2b3c4d',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 120, nullable: true })
  claimedBy: string | null;

  @ApiPropertyOptional({
    format: 'uuid',
    example: 'b87c2962-ab5a-44ea-b782-e5ea20e2b230',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true })
  claimToken: string | null;

  @ApiProperty({
    format: 'date-time',
    example: '2026-03-26T07:50:00.000Z',
  })
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @ApiProperty({
    format: 'date-time',
    example: '2026-03-26T07:55:00.000Z',
  })
  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
