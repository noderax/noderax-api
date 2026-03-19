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
import { NodeStatus } from './node-status.enum';

@Entity({ name: 'nodes' })
export class NodeEntity {
  @ApiProperty({
    format: 'uuid',
    example: 'b7f88611-b63e-4c95-9f37-4afb5c0cf275',
  })
  @PrimaryGeneratedColumn('uuid')
  id: string;

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
