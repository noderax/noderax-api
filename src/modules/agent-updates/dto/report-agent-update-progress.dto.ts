import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { AGENT_UPDATE_TARGET_ACTIVE_STATUSES } from '../entities/agent-update-statuses';

const ALLOWED_PROGRESS_STATUSES = [
  ...AGENT_UPDATE_TARGET_ACTIVE_STATUSES,
  'failed',
] as const;

export class ReportAgentUpdateProgressDto {
  @ApiProperty({
    enum: ALLOWED_PROGRESS_STATUSES,
    example: 'installing',
  })
  @IsEnum(ALLOWED_PROGRESS_STATUSES)
  status: (typeof ALLOWED_PROGRESS_STATUSES)[number];

  @ApiProperty({
    minimum: 0,
    maximum: 100,
    example: 70,
  })
  @IsInt()
  @Min(0)
  @Max(100)
  progressPercent: number;

  @ApiPropertyOptional({
    example: 'Verifying the official amd64 binary checksum.',
  })
  @IsOptional()
  @IsString()
  message?: string;
}
