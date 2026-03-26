import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';

export class ValidatePostgresConnectionDto {
  @ApiProperty({
    example: '127.0.0.1',
  })
  @IsString()
  @MinLength(1)
  host: string;

  @ApiPropertyOptional({
    example: 5432,
    default: 5432,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number = 5432;

  @ApiProperty({
    example: 'postgres',
  })
  @IsString()
  @MinLength(1)
  username: string;

  @ApiProperty({
    example: 'postgres',
  })
  @IsString()
  password: string;

  @ApiProperty({
    example: 'noderax',
  })
  @IsString()
  @MinLength(1)
  database: string;

  @ApiPropertyOptional({
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  ssl?: boolean = false;
}
