import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class CreateTerminalSessionDto {
  @ApiPropertyOptional({ example: 120, default: 120 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(20)
  @Max(400)
  cols?: number;

  @ApiPropertyOptional({ example: 34, default: 34 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(10)
  @Max(200)
  rows?: number;
}
