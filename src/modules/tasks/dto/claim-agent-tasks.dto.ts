import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { clampInteger } from '../../../common/utils/clamp-integer.util';

export class ClaimAgentTasksDto {
  @ApiPropertyOptional({
    example: 1,
    minimum: 1,
    maximum: 1,
    default: 1,
    description: 'Current API supports claiming a single task per call.',
  })
  @IsOptional()
  @Transform(({ value }) => clampInteger(value, { min: 1, max: 1 }))
  @IsInt()
  @Min(1)
  @Max(1)
  maxTasks?: number;

  @ApiPropertyOptional({
    example: 15000,
    minimum: 0,
    maximum: 30000,
    default: 15000,
    description: 'Long-poll wait budget in milliseconds.',
  })
  @IsOptional()
  @Transform(({ value }) => clampInteger(value, { min: 0, max: 30000 }))
  @IsInt()
  @Min(0)
  @Max(30000)
  waitMs?: number;

  @ApiPropertyOptional({
    isArray: true,
    type: String,
    example: ['docker', 'apt'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  capabilities?: string[];
}
