import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Index('IDX_task_templates_workspace_created_at', ['workspaceId', 'createdAt'])
@Entity({ name: 'task_templates' })
export class TaskTemplateEntity {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ format: 'uuid' })
  @Column({ type: 'uuid' })
  workspaceId: string;

  @ApiProperty()
  @Column({ length: 160 })
  name: string;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'text', nullable: true })
  description: string | null;

  @ApiProperty({ example: 'shell.exec' })
  @Column({ length: 120 })
  taskType: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
  })
  @Column({ type: 'jsonb', default: {} })
  payloadTemplate: Record<string, unknown>;

  @ApiProperty({ format: 'uuid' })
  @Column({ type: 'uuid' })
  createdByUserId: string;

  @ApiProperty({ format: 'uuid' })
  @Column({ type: 'uuid' })
  updatedByUserId: string;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  @Column({ type: 'timestamptz', nullable: true })
  archivedAt: Date | null;

  @ApiProperty({ format: 'date-time' })
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @ApiProperty({ format: 'date-time' })
  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
