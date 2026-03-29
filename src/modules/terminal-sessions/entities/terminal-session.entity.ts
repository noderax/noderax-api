import {
  ApiHideProperty,
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TerminalSessionStatus } from './terminal-session-status.enum';
import { TerminalSessionChunkEntity } from './terminal-session-chunk.entity';

@Index('IDX_terminal_sessions_node_created_at', ['nodeId', 'createdAt'])
@Index('IDX_terminal_sessions_workspace_created_at', [
  'workspaceId',
  'createdAt',
])
@Entity({ name: 'terminal_sessions' })
export class TerminalSessionEntity {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ format: 'uuid' })
  @Column({ type: 'uuid' })
  workspaceId: string;

  @ApiProperty({ format: 'uuid' })
  @Column({ type: 'uuid' })
  nodeId: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @Column({ type: 'uuid', nullable: true })
  createdByUserId: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ length: 255, nullable: true })
  createdByEmailSnapshot: string | null;

  @ApiProperty({
    enum: TerminalSessionStatus,
    enumName: 'TerminalSessionStatus',
  })
  @Column({
    type: 'varchar',
    length: 24,
    default: TerminalSessionStatus.PENDING,
  })
  status: TerminalSessionStatus;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  @Column({ type: 'timestamptz', nullable: true })
  openedAt: Date | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  @Column({ type: 'timestamptz', nullable: true })
  closedAt: Date | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'text', nullable: true })
  closedReason: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'int', nullable: true })
  exitCode: number | null;

  @ApiProperty({ example: 120 })
  @Column({ type: 'int', default: 120 })
  cols: number;

  @ApiProperty({ example: 34 })
  @Column({ type: 'int', default: 34 })
  rows: number;

  @ApiProperty({ format: 'date-time' })
  @Column({ type: 'timestamptz' })
  retentionExpiresAt: Date;

  @ApiHideProperty()
  @Column({ type: 'bigint', default: 0 })
  transcriptBytes: string;

  @ApiHideProperty()
  @Column({ type: 'int', default: 0 })
  chunkCount: number;

  @ApiHideProperty()
  @Column({ type: 'int', default: 0 })
  lastChunkSeq: number;

  @ApiProperty({ format: 'date-time' })
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @ApiProperty({ format: 'date-time' })
  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @ApiPropertyOptional({
    type: () => TerminalSessionChunkEntity,
    isArray: true,
  })
  @OneToMany(() => TerminalSessionChunkEntity, (chunk) => chunk.session)
  chunks?: TerminalSessionChunkEntity[];
}
