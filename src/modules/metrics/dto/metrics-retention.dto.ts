import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsInt, Max, Min } from 'class-validator';

export class UpdateMetricsRetentionDto {
  @ApiProperty({
    description: 'Whether the scheduled metrics retention cleanup is active.',
    example: true,
  })
  @IsBoolean()
  enabled: boolean;

  @ApiProperty({
    description:
      'Delete metrics whose recordedAt is older than this many days.',
    example: 30,
    minimum: 1,
    maximum: 3650,
  })
  @IsInt()
  @Min(1)
  @Max(3650)
  retentionDays: number;
}

export class MetricsRetentionSettingsDto {
  @ApiProperty({ example: true })
  enabled: boolean;

  @ApiProperty({ example: 30 })
  retentionDays: number;

  @ApiProperty({
    description:
      'Whether this deployment can persist retention settings (installer-managed).',
    example: true,
  })
  editable: boolean;

  @ApiProperty({
    description: 'When the retention cleanup last completed.',
    example: '2026-07-04T12:35:00.000Z',
    nullable: true,
  })
  lastRunAt: string | null;

  @ApiProperty({
    description: 'Number of metric rows deleted during the last cleanup run.',
    example: 12048,
    nullable: true,
  })
  lastDeletedCount: number | null;
}

export class MetricsRetentionRunResponseDto {
  @ApiProperty({ example: 12048 })
  deletedCount: number;

  @ApiProperty({ example: '2026-07-04T12:35:00.000Z' })
  runAt: string;
}
