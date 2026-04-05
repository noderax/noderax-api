import {
  ApiHideProperty,
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { EventSeverity } from '../../events/entities/event-severity.enum';
import type { NodeRootAccessProfile as NodeRootAccessProfileValue } from './node-root-access-profile.enum';
import { NodeRootAccessProfile } from './node-root-access-profile.enum';
import type { NodeRootAccessSyncStatus as NodeRootAccessSyncStatusValue } from './node-root-access-sync-status.enum';
import { NodeRootAccessSyncStatus } from './node-root-access-sync-status.enum';
import { NodeStatus } from './node-status.enum';

const DEFAULT_NODE_NOTIFICATION_LEVELS = [
  EventSeverity.INFO,
  EventSeverity.WARNING,
  EventSeverity.CRITICAL,
];

@Entity({ name: 'nodes' })
export class NodeEntity {
  @ApiProperty({
    format: 'uuid',
    example: 'b7f88611-b63e-4c95-9f37-4afb5c0cf275',
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
    example: 'srv-01',
  })
  @Column({ length: 120 })
  name: string;

  @ApiPropertyOptional({
    example: 'Primary web node in eu-central-1',
    nullable: true,
  })
  @Column({ type: 'text', nullable: true })
  description: string | null;

  @ApiProperty({
    example: 'srv-01',
  })
  @Index({ unique: true })
  @Column({ length: 255 })
  hostname: string;

  @ApiProperty({
    example: 'ubuntu-24.04',
  })
  @Column({ length: 120 })
  os: string;

  @ApiProperty({
    example: 'amd64',
  })
  @Column({ length: 64 })
  arch: string;

  @ApiProperty({
    enum: NodeStatus,
    enumName: 'NodeStatus',
    example: NodeStatus.ONLINE,
    description:
      'Current node status. Background offline detection marks stale nodes offline after the configured heartbeat timeout.',
  })
  @Column({
    type: 'enum',
    enum: NodeStatus,
    enumName: 'node_status_enum',
    default: NodeStatus.OFFLINE,
  })
  status: NodeStatus;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'Operational owner team for the node.',
  })
  @Column({ type: 'uuid', nullable: true })
  teamId?: string | null;

  @ApiPropertyOptional({
    example: 'SRE',
    nullable: true,
  })
  teamName?: string | null;

  @ApiPropertyOptional({
    example: false,
    nullable: true,
  })
  @Column({ type: 'boolean', default: false })
  maintenanceMode?: boolean;

  @ApiProperty({
    example: true,
    description:
      'Whether node-scoped event notifications may be delivered by email when the workspace email channel is enabled.',
  })
  @Column({ type: 'boolean', default: true })
  notificationEmailEnabled: boolean;

  @ApiProperty({
    enum: EventSeverity,
    enumName: 'EventSeverity',
    isArray: true,
    example: DEFAULT_NODE_NOTIFICATION_LEVELS,
    description:
      'Which node-scoped event severities may be delivered by email when the workspace email channel is enabled.',
  })
  @Column({
    type: 'simple-array',
    default: DEFAULT_NODE_NOTIFICATION_LEVELS.join(','),
  })
  notificationEmailLevels: EventSeverity[];

  @ApiProperty({
    example: true,
    description:
      'Whether node-scoped event notifications may be delivered by Telegram when the workspace Telegram channel is enabled.',
  })
  @Column({ type: 'boolean', default: true })
  notificationTelegramEnabled: boolean;

  @ApiProperty({
    enum: EventSeverity,
    enumName: 'EventSeverity',
    isArray: true,
    example: DEFAULT_NODE_NOTIFICATION_LEVELS,
    description:
      'Which node-scoped event severities may be delivered by Telegram when the workspace Telegram channel is enabled.',
  })
  @Column({
    type: 'simple-array',
    default: DEFAULT_NODE_NOTIFICATION_LEVELS.join(','),
  })
  notificationTelegramLevels: EventSeverity[];

  @ApiProperty({
    enum: NodeRootAccessProfile,
    enumName: 'NodeRootAccessProfile',
    example: NodeRootAccessProfile.OFF,
  })
  @Column({
    type: 'enum',
    enum: NodeRootAccessProfile,
    enumName: 'node_root_access_profile_enum',
    default: NodeRootAccessProfile.OFF,
  })
  rootAccessProfile: NodeRootAccessProfileValue;

  @ApiProperty({
    enum: NodeRootAccessProfile,
    enumName: 'NodeRootAccessProfile',
    example: NodeRootAccessProfile.OFF,
  })
  @Column({
    type: 'enum',
    enum: NodeRootAccessProfile,
    enumName: 'node_root_access_profile_enum',
    default: NodeRootAccessProfile.OFF,
  })
  rootAccessAppliedProfile: NodeRootAccessProfileValue;

  @ApiProperty({
    enum: NodeRootAccessSyncStatus,
    enumName: 'NodeRootAccessSyncStatus',
    example: NodeRootAccessSyncStatus.PENDING,
  })
  @Column({
    type: 'enum',
    enum: NodeRootAccessSyncStatus,
    enumName: 'node_root_access_sync_status_enum',
    default: NodeRootAccessSyncStatus.PENDING,
  })
  rootAccessSyncStatus: NodeRootAccessSyncStatusValue;

  @ApiPropertyOptional({
    format: 'date-time',
    nullable: true,
  })
  @Column({ type: 'timestamptz', nullable: true })
  rootAccessUpdatedAt?: Date | null;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true })
  rootAccessUpdatedByUserId?: string | null;

  @ApiPropertyOptional({
    format: 'date-time',
    nullable: true,
  })
  @Column({ type: 'timestamptz', nullable: true })
  rootAccessLastAppliedAt?: Date | null;

  @ApiPropertyOptional({
    nullable: true,
  })
  @Column({ type: 'text', nullable: true })
  rootAccessLastError?: string | null;

  @ApiPropertyOptional({
    nullable: true,
  })
  @Column({ type: 'text', nullable: true })
  maintenanceReason?: string | null;

  @ApiPropertyOptional({
    format: 'date-time',
    nullable: true,
  })
  @Column({ type: 'timestamptz', nullable: true })
  maintenanceStartedAt?: Date | null;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true })
  maintenanceByUserId?: string | null;

  @ApiPropertyOptional({
    example: '1.2.3',
    nullable: true,
  })
  @Column({ length: 64, nullable: true })
  agentVersion?: string | null;

  @ApiPropertyOptional({
    example: '24.04',
    nullable: true,
  })
  @Column({ length: 120, nullable: true })
  platformVersion?: string | null;

  @ApiPropertyOptional({
    example: '6.8.0',
    nullable: true,
  })
  @Column({ length: 120, nullable: true })
  kernelVersion?: string | null;

  @ApiPropertyOptional({
    format: 'date-time',
    nullable: true,
  })
  @Column({ type: 'timestamptz', nullable: true })
  lastVersionReportedAt?: Date | null;

  @ApiPropertyOptional({
    format: 'date-time',
    example: '2026-03-17T12:32:10.000Z',
    nullable: true,
    description:
      'Timestamp of the last successful heartbeat or agent activity seen by the control plane.',
  })
  @Column({ type: 'timestamptz', nullable: true })
  lastSeenAt: Date | null;

  @ApiHideProperty()
  @Column({ nullable: true, select: false })
  agentTokenHash: string | null;

  @ApiProperty({
    format: 'date-time',
    example: '2026-03-17T12:30:00.000Z',
  })
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @ApiProperty({
    format: 'date-time',
    example: '2026-03-17T12:30:00.000Z',
  })
  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
