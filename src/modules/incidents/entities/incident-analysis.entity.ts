import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Index('IDX_incident_analyses_incident_created_at', ['incidentId', 'createdAt'])
@Entity({ name: 'incident_analyses' })
export class IncidentAnalysisEntity {
  @ApiProperty({
    format: 'uuid',
  })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({
    format: 'uuid',
  })
  @Column({ type: 'uuid' })
  incidentId: string;

  @ApiProperty({
    example: 'gpt-5.4-mini',
  })
  @Column({ length: 120 })
  model: string;

  @ApiProperty({
    example:
      'Authentication failures rose sharply after a new client IP appeared.',
  })
  @Column({ type: 'text' })
  summary: string;

  @ApiProperty({
    type: [String],
    example: ['Brute-force SSH attempts', 'Misconfigured client credentials'],
  })
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  probableCauses: string[];

  @ApiProperty({
    type: [String],
    example: [
      'Check source IP reputation',
      'Review recent sshd config changes',
    ],
  })
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  recommendedChecks: string[];

  @ApiPropertyOptional({
    example: 12000,
    nullable: true,
  })
  @Column({ type: 'integer', nullable: true })
  inputTokens: number | null;

  @ApiPropertyOptional({
    example: 1500,
    nullable: true,
  })
  @Column({ type: 'integer', nullable: true })
  outputTokens: number | null;

  @ApiPropertyOptional({
    example: 0.01575,
    nullable: true,
  })
  @Column({ type: 'numeric', precision: 12, scale: 6, nullable: true })
  estimatedCostUsd: string | null;

  @ApiProperty({
    format: 'date-time',
  })
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
