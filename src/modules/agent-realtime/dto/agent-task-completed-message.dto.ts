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
  TASK_OUTPUT_MAX_LENGTH,
} from '../../tasks/dto/complete-agent-task.dto';

export class AgentTaskCompletedMessageDto {
  @ApiPropertyOptional({
    example: 'task.completed',
  })
  @IsString()
  @IsIn(['task.completed'])
  type: 'task.completed';

  @ApiProperty({
    format: 'uuid',
    example: 'ec9f97f2-7b56-4a7e-a7cb-5c957e9d32d8',
  })
  @IsUUID()
  taskId: string;

  @ApiProperty({
    enum: AGENT_TASK_TERMINAL_STATUSES,
    example: 'success',
  })
  @IsIn(AGENT_TASK_TERMINAL_STATUSES)
  status: CompleteAgentTaskDto['status'];

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
    example: 0,
  })
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
    example: '2026-03-18T10:19:10.000Z',
  })
  @IsOptional()
  @IsDateString()
  timestamp?: string;

  @ApiPropertyOptional({
    example: 7032,
  })
  @IsOptional()
  @IsInt()
  durationMs?: number;
}
