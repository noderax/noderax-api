import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class AgentTaskLogHttpDto {
  @ApiPropertyOptional({
    format: 'uuid',
    example: 'ec9f97f2-7b56-4a7e-a7cb-5c957e9d32d8',
    description: 'Must match route taskId when provided.',
  })
  @IsOptional()
  @IsUUID()
  taskId?: string;

  @ApiProperty({ example: 'stdout' })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  stream: string;

  @ApiProperty({ example: 'Pulling package metadata...' })
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  line: string;

  @ApiPropertyOptional({
    format: 'date-time',
    example: '2026-03-22T16:47:33.000Z',
  })
  @IsOptional()
  @IsDateString()
  timestamp?: string;
}
