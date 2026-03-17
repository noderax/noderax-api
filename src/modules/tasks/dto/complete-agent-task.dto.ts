import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { TaskStatus } from '../entities/task-status.enum';
import { AgentTaskAuthDto } from './agent-task-auth.dto';

export const AGENT_TASK_TERMINAL_STATUSES = [
  TaskStatus.SUCCESS,
  TaskStatus.FAILED,
  TaskStatus.CANCELLED,
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
  @MaxLength(10000)
  output?: string;
}
