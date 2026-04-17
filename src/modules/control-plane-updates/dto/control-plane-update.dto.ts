import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const CONTROL_PLANE_UPDATE_OPERATIONS = ['download', 'apply'] as const;
export const CONTROL_PLANE_UPDATE_STATUSES = [
  'queued',
  'downloading',
  'verifying',
  'extracting',
  'loading_images',
  'prepared',
  'applying',
  'recreating_services',
  'completed',
  'failed',
] as const;

export class ControlPlaneReleaseDto {
  @ApiProperty({
    example: '1.0.0',
  })
  version: string;

  @ApiProperty({
    example: '20260412T140001Z',
  })
  releaseId: string;

  @ApiPropertyOptional({
    format: 'date-time',
    nullable: true,
  })
  releasedAt: string | null;

  @ApiPropertyOptional({
    format: 'date-time',
    nullable: true,
  })
  builtAt?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    example: '0fdfeb8c...',
  })
  bundleSha256?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    example:
      'https://cdn.noderax.net/noderax-platform/releases/1.0.0/platform-bundle.tar.zst',
  })
  bundleUrl?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    example:
      'https://cdn.noderax.net/noderax-platform/releases/latest/release-manifest.json',
  })
  manifestUrl?: string | null;
}

export class ControlPlaneUpdateOperationDto {
  @ApiProperty({
    enum: CONTROL_PLANE_UPDATE_OPERATIONS,
  })
  operation: (typeof CONTROL_PLANE_UPDATE_OPERATIONS)[number];

  @ApiProperty({
    enum: CONTROL_PLANE_UPDATE_STATUSES,
  })
  status: (typeof CONTROL_PLANE_UPDATE_STATUSES)[number];

  @ApiPropertyOptional({
    nullable: true,
  })
  message: string | null;

  @ApiPropertyOptional({
    nullable: true,
  })
  error: string | null;

  @ApiProperty({
    format: 'date-time',
  })
  requestedAt: string;

  @ApiPropertyOptional({
    format: 'date-time',
    nullable: true,
  })
  startedAt: string | null;

  @ApiPropertyOptional({
    format: 'date-time',
    nullable: true,
  })
  completedAt: string | null;

  @ApiPropertyOptional({
    nullable: true,
    example: 'admin@example.com',
  })
  requestedByEmailSnapshot: string | null;

  @ApiPropertyOptional({
    enum: ['not_needed', 'succeeded', 'failed'],
    nullable: true,
  })
  rollbackStatus: 'not_needed' | 'succeeded' | 'failed' | null;

  @ApiPropertyOptional({
    nullable: true,
    example: '20260416T222058Z',
  })
  targetReleaseId: string | null;

  @ApiPropertyOptional({
    nullable: true,
    example: '1.0.0',
  })
  targetVersion: string | null;
}

export class ControlPlaneUpdateSummaryDto {
  @ApiProperty({
    example: true,
  })
  supported: boolean;

  @ApiPropertyOptional({
    nullable: true,
    example: 'installer_managed',
  })
  deploymentMode: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: ControlPlaneReleaseDto,
  })
  currentRelease: ControlPlaneReleaseDto | null;

  @ApiPropertyOptional({
    nullable: true,
    type: ControlPlaneReleaseDto,
  })
  latestRelease: ControlPlaneReleaseDto | null;

  @ApiPropertyOptional({
    nullable: true,
    type: ControlPlaneReleaseDto,
  })
  preparedRelease: ControlPlaneReleaseDto | null;

  @ApiProperty({
    example: true,
  })
  updateAvailable: boolean;

  @ApiPropertyOptional({
    nullable: true,
    type: ControlPlaneUpdateOperationDto,
  })
  operation: ControlPlaneUpdateOperationDto | null;

  @ApiPropertyOptional({
    format: 'date-time',
    nullable: true,
  })
  releaseCheckedAt: string | null;
}
