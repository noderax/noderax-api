import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';

export class CreateLogPreviewDto {
  @ApiProperty({
    example: 'auth.log',
  })
  @IsString()
  @MinLength(1)
  sourcePresetId: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 500,
    default: 200,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  backfillLines?: number;
}
