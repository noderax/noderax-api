import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { TaskLogLevel } from '../entities/task-log-level.enum';
import { AgentTaskAuthDto } from './agent-task-auth.dto';

export class AppendTaskLogDto extends AgentTaskAuthDto {
  @ApiProperty({
    example: 'Running docker ps --format json',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  message: string;

  @ApiPropertyOptional({
    enum: TaskLogLevel,
    enumName: 'TaskLogLevel',
    example: TaskLogLevel.STDOUT,
    default: TaskLogLevel.INFO,
  })
  @IsOptional()
  @IsEnum(TaskLogLevel)
  level?: TaskLogLevel;
}
