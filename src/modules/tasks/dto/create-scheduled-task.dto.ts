import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import {
  SCHEDULED_TASK_CADENCES,
  SCHEDULED_TASK_TIMEZONE,
  ScheduledTaskCadence,
} from '../scheduled-task.utils';

export class CreateScheduledTaskDto {
  @ApiProperty({
    format: 'uuid',
    example: 'b7f88611-b63e-4c95-9f37-4afb5c0cf275',
  })
  @IsUUID()
  nodeId: string;

  @ApiProperty({
    example: 'Daily hostname check',
  })
  @IsString()
  @MinLength(2)
  name: string;

  @ApiProperty({
    example: 'hostname',
  })
  @IsString()
  @MinLength(1)
  command: string;

  @ApiProperty({
    enum: SCHEDULED_TASK_CADENCES,
    example: 'daily',
  })
  @IsIn(SCHEDULED_TASK_CADENCES)
  cadence: ScheduledTaskCadence;

  @ApiProperty({
    example: 15,
    minimum: 0,
    maximum: 59,
  })
  @IsInt()
  @Min(0)
  @Max(59)
  minute: number;

  @ApiPropertyOptional({
    example: 3,
    minimum: 0,
    maximum: 23,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  hour?: number;

  @ApiPropertyOptional({
    example: 1,
    minimum: 0,
    maximum: 6,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek?: number;

  @ApiPropertyOptional({
    example: SCHEDULED_TASK_TIMEZONE,
    default: SCHEDULED_TASK_TIMEZONE,
  })
  @IsOptional()
  @IsString()
  @IsIn([SCHEDULED_TASK_TIMEZONE])
  timezone?: typeof SCHEDULED_TASK_TIMEZONE;
}
