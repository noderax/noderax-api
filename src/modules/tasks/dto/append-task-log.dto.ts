import {
  ApiHideProperty,
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger';
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
  @ApiHideProperty()
  @IsOptional()
  @IsDateString()
  timestamp?: string;

  @ApiHideProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  stream: string;

  @ApiHideProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  line: string;
}

export class AppendTaskLogDto extends AgentTaskAuthDto {
  @ApiProperty({
    example: 'Running docker ps --format json',
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

  @ApiHideProperty()
  @IsOptional()
  @IsString()
  taskId?: string;

  @ApiHideProperty()
  @IsOptional()
  @IsArray()
  entries?: AgentTaskLogEntryDto[];
}
