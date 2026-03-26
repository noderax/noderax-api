import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

@Unique('UQ_teams_workspace_name', ['workspaceId', 'name'])
@Entity({ name: 'teams' })
export class TeamEntity {
  @ApiProperty({
    format: 'uuid',
    example: 'ce391c51-5f42-4d77-bef2-6107be4db31e',
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
    example: 'Platform Ops',
  })
  @Column({ length: 120 })
  name: string;

  @ApiPropertyOptional({
    example: 'Day-to-day platform operators',
    nullable: true,
  })
  @Column({ type: 'text', nullable: true })
  description: string | null;

  @ApiProperty({
    format: 'date-time',
    example: '2026-03-26T09:10:00.000Z',
  })
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @ApiProperty({
    format: 'date-time',
    example: '2026-03-26T09:10:00.000Z',
  })
  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
