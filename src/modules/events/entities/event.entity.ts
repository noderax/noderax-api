import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { EventSeverity } from './event-severity.enum';

@Entity({ name: 'events' })
export class EventEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  nodeId: string | null;

  @Column({ length: 120 })
  type: string;

  @Column({
    type: 'enum',
    enum: EventSeverity,
    enumName: 'event_severity_enum',
    default: EventSeverity.INFO,
  })
  severity: EventSeverity;

  @Column({ type: 'text' })
  message: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
