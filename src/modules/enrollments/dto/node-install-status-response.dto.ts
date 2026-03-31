import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NodeInstallStatus } from '../entities/node-install-status.enum';

export class NodeInstallStatusResponseDto {
  @ApiProperty({
    format: 'uuid',
    example: 'f6f9b1a7-62de-4d53-b37a-c6e1ffefbb6f',
  })
  installId: string;

  @ApiProperty({
    format: 'uuid',
    example: '9d4174b9-5dc2-4891-8d1b-f0a2f6c4e52c',
  })
  workspaceId: string;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    example: 'd9f0f85a-b86f-4e7b-a917-6a3f61b44c2b',
  })
  teamId?: string | null;

  @ApiProperty({
    example: 'Production Node EU-1',
  })
  nodeName: string;

  @ApiPropertyOptional({
    nullable: true,
    example: 'Primary web node in eu-central-1',
  })
  description?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    example: 'srv-prod-01',
  })
  hostname?: string | null;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    example: 'b7f88611-b63e-4c95-9f37-4afb5c0cf275',
  })
  nodeId?: string | null;

  @ApiProperty({
    enum: NodeInstallStatus,
    example: NodeInstallStatus.INSTALLING,
  })
  status: NodeInstallStatus;

  @ApiProperty({
    example: 'binary_downloaded',
  })
  stage: string;

  @ApiProperty({
    minimum: 0,
    maximum: 100,
    example: 72,
  })
  progressPercent: number;

  @ApiPropertyOptional({
    nullable: true,
    example: 'Agent binary downloaded. Bootstrapping node credentials next.',
  })
  statusMessage?: string | null;

  @ApiPropertyOptional({
    format: 'date-time',
    nullable: true,
    example: '2026-03-31T12:34:56.000Z',
  })
  startedAt?: Date | null;

  @ApiPropertyOptional({
    format: 'date-time',
    nullable: true,
    example: '2026-03-31T12:35:45.000Z',
  })
  consumedAt?: Date | null;

  @ApiProperty({
    format: 'date-time',
    example: '2026-03-31T12:49:56.000Z',
  })
  expiresAt: Date;

  @ApiProperty({
    format: 'date-time',
    example: '2026-03-31T12:34:56.000Z',
  })
  createdAt: Date;

  @ApiProperty({
    format: 'date-time',
    example: '2026-03-31T12:35:12.000Z',
  })
  updatedAt: Date;
}
