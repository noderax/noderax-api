import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { clampInteger } from '../../../common/utils/clamp-integer.util';

export class QueryMetricsDto {
  @ApiPropertyOptional({
    format: 'uuid',
    example: 'b7f88611-b63e-4c95-9f37-4afb5c0cf275',
  })
  @IsOptional()
  @IsUUID()
  nodeId?: string;

  @ApiPropertyOptional({
    example: 50,
    minimum: 1,
    maximum: 100,
    default: 50,
  })
  @IsOptional()
  @Transform(({ value }) => clampInteger(value, { min: 1, max: 100 }))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
