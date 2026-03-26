import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'metrics' })
export class MetricEntity {
  @ApiProperty({
    format: 'uuid',
    example: '182062f5-6ee4-4e46-b66b-e297949fc5a8',
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
  @Index()
  @Column({ type: 'uuid' })
  nodeId: string;

  @ApiProperty({
    example: 42.5,
  })
  @Column({ type: 'real' })
  cpuUsage: number;

  @ApiProperty({
    example: 63.1,
  })
  @Column({ type: 'real' })
  memoryUsage: number;

  @ApiProperty({
    example: 58.4,
  })
  @Column({ type: 'real' })
  diskUsage: number;

  @ApiPropertyOptional({
    example: 45.2,
    description: 'Maximum core temperature in Celsius',
  })
  @Column({ type: 'real', nullable: true })
  temperature: number | null;

  @ApiProperty({
    example: {
      rxBytes: 124000,
      txBytes: 98000,
    },
    type: 'object',
    additionalProperties: true,
  })
  @Column({ type: 'jsonb' })
  networkStats: Record<string, unknown>;

  @ApiProperty({
    format: 'date-time',
    example: '2026-03-17T12:35:00.000Z',
  })
  @CreateDateColumn({ type: 'timestamptz' })
  recordedAt: Date;
}
