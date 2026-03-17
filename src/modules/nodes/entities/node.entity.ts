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
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 120 })
  name: string;

  @Index({ unique: true })
  @Column({ length: 255 })
  hostname: string;

  @Column({ length: 120 })
  os: string;

  @Column({ length: 64 })
  arch: string;

  @Column({
    type: 'enum',
    enum: NodeStatus,
    enumName: 'node_status_enum',
    default: NodeStatus.OFFLINE,
  })
  status: NodeStatus;

  @Column({ type: 'timestamptz', nullable: true })
  lastSeenAt: Date | null;

  @Column({ nullable: true, select: false })
  agentTokenHash: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
