import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { clampInteger } from '../../../common/utils/clamp-integer.util';

export class QueryWorkspaceSearchDto {
  @ApiPropertyOptional({
    example: 'shell',
  })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 10,
    default: 5,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  @Transform(({ value }) => clampInteger(value, { min: 1, max: 10 }))
  limit?: number;
}
