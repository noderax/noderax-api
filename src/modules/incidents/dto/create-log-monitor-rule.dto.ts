import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { LOG_MONITOR_CADENCES } from '../entities/log-monitor-cadence.enum';

export class CreateLogMonitorRuleDto {
  @ApiProperty({
    example: 'Detect repeated SSH authentication failures',
  })
  @IsString()
  @MinLength(2)
  name: string;

  @ApiProperty({
    example: 'auth.log',
  })
  @IsString()
  @MinLength(1)
  sourcePresetId: string;

  @ApiPropertyOptional({
    enum: LOG_MONITOR_CADENCES,
    example: 'minutely',
    default: 'minutely',
  })
  @IsOptional()
  @IsIn(LOG_MONITOR_CADENCES)
  cadence?: string;

  @ApiPropertyOptional({
    example: 1,
    minimum: 1,
    maximum: 60,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  intervalMinutes?: number;

  @ApiPropertyOptional({
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
  })
  @IsObject()
  dsl: Record<string, unknown>;
}
