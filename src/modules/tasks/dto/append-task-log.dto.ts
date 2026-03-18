import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { TaskLogLevel } from '../entities/task-log-level.enum';
import { AgentTaskAuthDto } from './agent-task-auth.dto';

export class AgentTaskLogEntryDto {
  @ApiPropertyOptional({
    format: 'date-time',
    example: '2026-03-18T10:18:05.000Z',
    description: 'Optional timestamp attached to a streamed log line.',
  })
  @IsOptional()
  @IsDateString()
  timestamp?: string;

  @ApiProperty({
    example: 'stdout',
    description: 'Source stream for the line, typically stdout or stderr.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  stream: string;

  @ApiProperty({
    example: 'Pulling latest image digest...',
    description: 'Single log line emitted by the agent.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  line: string;
}

export class AppendTaskLogDto extends AgentTaskAuthDto {
  @ApiProperty({
    example: 'Running docker ps --format json',
    description:
      'Single log message. Use this for legacy clients that do not send batched entries.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  @IsOptional()
  message?: string;

  @ApiPropertyOptional({
    enum: TaskLogLevel,
    enumName: 'TaskLogLevel',
    example: TaskLogLevel.STDOUT,
    default: TaskLogLevel.INFO,
  })
  @IsOptional()
  @IsEnum(TaskLogLevel)
  level?: TaskLogLevel;

  @ApiPropertyOptional({
    format: 'uuid',
    example: 'ec9f97f2-7b56-4a7e-a7cb-5c957e9d32d8',
    description:
      'Optional task identifier echoed by the agent. Must match the route parameter when provided.',
  })
  @IsOptional()
  @IsString()
  taskId?: string;

  @ApiPropertyOptional({
    type: AgentTaskLogEntryDto,
    isArray: true,
    description:
      'Preferred batched log payload used by the Go agent. Each entry becomes a persisted task log row.',
  })
  @IsOptional()
  @IsArray()
  entries?: AgentTaskLogEntryDto[];
}
