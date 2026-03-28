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
  ScheduledTaskCadence,
} from '../scheduled-task.utils';

export class CreateScheduledTaskDto {
  @ApiPropertyOptional({
    format: 'uuid',
    example: 'b7f88611-b63e-4c95-9f37-4afb5c0cf275',
  })
  @IsOptional()
  @IsUUID()
  nodeId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  teamId?: string;

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

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
  })
  @IsOptional()
  @IsUUID()
  templateId?: string;

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
    example: 5,
    minimum: 1,
    maximum: 10080,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10_080)
  intervalMinutes?: number;
}
