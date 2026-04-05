import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';
import { TaskStatus } from '../../tasks/entities/task-status.enum';

class LogPreviewEntryDto {
  @ApiPropertyOptional({
    format: 'date-time',
    nullable: true,
  })
  timestamp?: string | null;

  @ApiProperty({
    example:
      'Failed password for invalid user deploy from 10.0.0.12 port 53412 ssh2',
  })
  message: string;

  @ApiPropertyOptional({
    nullable: true,
  })
  unit?: string | null;

  @ApiPropertyOptional({
    nullable: true,
  })
  identifier?: string | null;
}

export class LogPreviewResponseDto {
  @ApiProperty({
    format: 'uuid',
  })
  taskId: string;

  @ApiProperty({
    enum: TaskStatus,
    enumName: 'TaskStatus',
  })
  taskStatus: TaskStatus;

  @ApiProperty({
    example: 'auth.log',
  })
  sourcePresetId: string;

  @ApiProperty({
    type: () => LogPreviewEntryDto,
    isArray: true,
  })
  entries: LogPreviewEntryDto[];

  @ApiProperty({
    example: false,
  })
  truncated: boolean;

  @ApiProperty({
    type: [String],
  })
  warnings: string[];

  @ApiPropertyOptional({
    nullable: true,
  })
  error: string | null;
}

export class IncidentAnalysisRequestDto {
  @ApiPropertyOptional({
    example: 'gpt-5.4-mini',
    default: 'gpt-5.4-mini',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  model?: string;
}

export class IncidentAnalysisResponseDto {
  @ApiProperty({
    format: 'uuid',
  })
  id: string;

  @ApiProperty({
    example: 'gpt-5.4-mini',
  })
  model: string;

  @ApiProperty({
    example:
      'Authentication failures are clustered around one source and likely reflect invalid credentials or brute-force attempts.',
  })
  summary: string;

  @ApiProperty({
    type: [String],
  })
  probableCauses: string[];

  @ApiProperty({
    type: [String],
  })
  recommendedChecks: string[];

  @ApiPropertyOptional({
    nullable: true,
  })
  inputTokens?: number | null;

  @ApiPropertyOptional({
    nullable: true,
  })
  outputTokens?: number | null;

  @ApiPropertyOptional({
    nullable: true,
    example: 0.01575,
  })
  estimatedCostUsd?: string | null;

  @ApiProperty({
    format: 'date-time',
  })
  createdAt: string;
}
