import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { TerminalTranscriptDirection } from './terminal-transcript-direction.enum';
import { TerminalSessionEntity } from './terminal-session.entity';

@Index('IDX_terminal_session_chunks_session_seq', ['sessionId', 'seq'], {
  unique: true,
})
@Index('IDX_terminal_session_chunks_session_created_at', [
  'sessionId',
  'createdAt',
])
@Entity({ name: 'terminal_session_chunks' })
export class TerminalSessionChunkEntity {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ format: 'uuid' })
  @Column({ type: 'uuid' })
  sessionId: string;

  @ApiProperty({
    enum: TerminalTranscriptDirection,
    enumName: 'TerminalTranscriptDirection',
  })
  @Column({ type: 'varchar', length: 24 })
  direction: TerminalTranscriptDirection;

  @ApiProperty({ example: 'base64' })
  @Column({ length: 24, default: 'base64' })
  encoding: string;

  @ApiProperty({ example: 'bHMK' })
  @Column({ type: 'text' })
  payload: string;

  @ApiProperty({ example: 1 })
  @Column({ type: 'int' })
  seq: number;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  @Column({ type: 'timestamptz', nullable: true })
  sourceTimestamp: Date | null;

  @ApiProperty({ format: 'date-time' })
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => TerminalSessionEntity, (session) => session.chunks, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'sessionId' })
  session?: TerminalSessionEntity;
}
