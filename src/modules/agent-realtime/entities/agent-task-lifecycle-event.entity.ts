import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Index('IDX_agent_task_lifecycle_task_created', ['taskId', 'createdAt'])
@Index(
  'UQ_agent_task_lifecycle_idempotency',
  ['taskId', 'eventType', 'eventTimestamp'],
  {
    unique: true,
  },
)
@Entity({ name: 'agent_task_lifecycle_events' })
export class AgentTaskLifecycleEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  nodeId: string;

  @Column({ type: 'uuid' })
  taskId: string;

  @Column({ length: 64 })
  eventType: string;

  @Column({ type: 'timestamptz' })
  eventTimestamp: Date;

  @Column({ type: 'jsonb', default: {} })
  payload: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
