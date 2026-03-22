import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { TaskStatus } from '../entities/task-status.enum';
import { AgentTaskAuthDto } from './agent-task-auth.dto';

export const TASK_OUTPUT_MAX_LENGTH = 200000;

export const AGENT_TASK_TERMINAL_STATUSES = [
  TaskStatus.SUCCESS,
  TaskStatus.FAILED,
  TaskStatus.CANCELLED,
  'canceled',
  'timeout',
] as const;

export class CompleteAgentTaskDto extends AgentTaskAuthDto {
  @ApiProperty({
    enum: AGENT_TASK_TERMINAL_STATUSES,
    example: TaskStatus.SUCCESS,
  })
  @IsIn(AGENT_TASK_TERMINAL_STATUSES)
  status: (typeof AGENT_TASK_TERMINAL_STATUSES)[number];

  @ApiPropertyOptional({
    example: {
      exitCode: 0,
      rowsAffected: 4,
    },
    type: 'object',
    additionalProperties: true,
  })
  @IsOptional()
  @IsObject()
  result?: Record<string, unknown>;

  @ApiPropertyOptional({
    example: 'Task finished with exit code 0',
  })
  @IsOptional()
  @IsString()
  @MaxLength(TASK_OUTPUT_MAX_LENGTH)
  output?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    example: 'ec9f97f2-7b56-4a7e-a7cb-5c957e9d32d8',
    description:
      'Optional task identifier echoed by the agent. Must match the route parameter when provided.',
  })
  @IsOptional()
  @IsUUID()
  taskId?: string;

  @ApiPropertyOptional({
    example: 0,
    description: 'Optional process exit code reported by the agent.',
  })
  @IsOptional()
  @IsInt()
  exitCode?: number;

  @ApiPropertyOptional({
    example: 'command exited with code 1',
    description: 'Optional human-readable error text for failed executions.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  error?: string;

  @ApiPropertyOptional({
    format: 'date-time',
    example: '2026-03-18T10:19:10.000Z',
    description: 'Optional agent-side completion timestamp.',
  })
  @IsOptional()
  @IsDateString()
  completedAt?: string;

  @ApiPropertyOptional({
    example: 7032,
    description:
      'Optional task duration reported by the agent in milliseconds.',
  })
  @IsOptional()
  @IsInt()
  durationMs?: number;
}
