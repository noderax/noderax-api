import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Index('IDX_log_monitor_cursors_rule_id', ['ruleId'], { unique: true })
@Entity({ name: 'log_monitor_cursors' })
export class LogMonitorCursorEntity {
  @ApiProperty({
    format: 'uuid',
  })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({
    format: 'uuid',
  })
  @Column({ type: 'uuid' })
  ruleId: string;

  @ApiProperty({
    format: 'uuid',
  })
  @Column({ type: 'uuid' })
  nodeId: string;

  @ApiProperty({
    example: 'auth.log',
  })
  @Column({ length: 64 })
  sourcePresetId: string;

  @ApiPropertyOptional({
    nullable: true,
  })
  @Column({ type: 'text', nullable: true })
  journalCursor: string | null;

  @ApiPropertyOptional({
    nullable: true,
  })
  @Column({ type: 'text', nullable: true })
  fileInode: string | null;

  @ApiPropertyOptional({
    nullable: true,
    example: 1024,
  })
  @Column({ type: 'bigint', nullable: true })
  fileOffset: string | null;

  @ApiPropertyOptional({
    format: 'date-time',
    nullable: true,
  })
  @Column({ type: 'timestamptz', nullable: true })
  lastReadAt: Date | null;

  @ApiPropertyOptional({
    nullable: true,
  })
  @Column({ type: 'text', nullable: true })
  cursorResetReason: string | null;

  @ApiProperty({
    format: 'date-time',
  })
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @ApiProperty({
    format: 'date-time',
  })
  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
