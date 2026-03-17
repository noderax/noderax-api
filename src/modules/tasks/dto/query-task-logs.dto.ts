import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { clampInteger } from '../../../common/utils/clamp-integer.util';

export class QueryTaskLogsDto {
  @ApiPropertyOptional({
    example: 100,
    minimum: 1,
    maximum: 100,
    default: 100,
  })
  @IsOptional()
  @Transform(({ value }) => clampInteger(value, { min: 1, max: 100 }))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
