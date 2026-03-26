import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
  @ApiProperty({
    format: 'uuid',
    example: 'a32ef4bf-4f7d-4031-9cb4-c50648972e73',
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

  @ApiPropertyOptional({
    format: 'uuid',
    example: 'b7f88611-b63e-4c95-9f37-4afb5c0cf275',
    nullable: true,
  })
  @Index()
  @Column({ type: 'uuid', nullable: true })
  nodeId: string | null;

  @ApiProperty({
    example: 'high.cpu',
  })
  @Column({ length: 120 })
  type: string;

  @ApiProperty({
    enum: EventSeverity,
    enumName: 'EventSeverity',
    example: EventSeverity.WARNING,
  })
  @Column({
    type: 'enum',
    enum: EventSeverity,
    enumName: 'event_severity_enum',
    default: EventSeverity.INFO,
  })
  severity: EventSeverity;

  @ApiProperty({
    example: 'CPU usage on srv-01 reached 95.2%',
  })
  @Column({ type: 'text' })
  message: string;

  @ApiPropertyOptional({
    example: {
      cpuUsage: 95.2,
    },
    type: 'object',
    additionalProperties: true,
    nullable: true,
  })
  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @ApiProperty({
    format: 'date-time',
    example: '2026-03-17T12:45:00.000Z',
  })
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
