import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'metrics' })
export class MetricEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  nodeId: string;

  @Column({ type: 'real' })
  cpuUsage: number;

  @Column({ type: 'real' })
  memoryUsage: number;

  @Column({ type: 'real' })
  diskUsage: number;

  @Column({ type: 'jsonb' })
  networkStats: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz' })
  recordedAt: Date;
}
