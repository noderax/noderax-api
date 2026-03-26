import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';

export class ValidateRedisConnectionDto {
  @ApiProperty({
    example: '127.0.0.1',
  })
  @IsString()
  @MinLength(1)
  host: string;

  @ApiPropertyOptional({
    example: 6379,
    default: 6379,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number = 6379;

  @ApiPropertyOptional({
    example: '',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  password?: string = '';

  @ApiPropertyOptional({
    example: 0,
    default: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  db?: number = 0;
}
