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
import {
  AGENT_TASK_TERMINAL_STATUSES,
  CompleteAgentTaskDto,
} from './complete-agent-task.dto';

export const HTTP_TASK_OUTPUT_MAX_LENGTH = 8000;

export class AgentTaskCompletedHttpDto {
  @ApiPropertyOptional({
    format: 'uuid',
    example: 'ec9f97f2-7b56-4a7e-a7cb-5c957e9d32d8',
    description: 'Must match route taskId when provided.',
  })
  @IsOptional()
  @IsUUID()
  taskId?: string;

  @ApiProperty({
    enum: AGENT_TASK_TERMINAL_STATUSES,
    example: 'success',
  })
  @IsIn(AGENT_TASK_TERMINAL_STATUSES)
  status: CompleteAgentTaskDto['status'];

  @ApiPropertyOptional({
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
  @MaxLength(200000)
  output?: string;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  exitCode?: number;

  @ApiPropertyOptional({
    example: 'command exited with code 1',
  })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  error?: string;

  @ApiPropertyOptional({
    format: 'date-time',
    example: '2026-03-22T16:47:39.000Z',
  })
  @IsOptional()
  @IsDateString()
  timestamp?: string;

  @ApiPropertyOptional({ example: 7032 })
  @IsOptional()
  @IsInt()
  durationMs?: number;
}
