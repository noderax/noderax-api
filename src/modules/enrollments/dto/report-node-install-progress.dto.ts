import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { NodeInstallStatus } from '../entities/node-install-status.enum';

const REPORTABLE_NODE_INSTALL_STATUSES = [
  NodeInstallStatus.INSTALLING,
  NodeInstallStatus.COMPLETED,
  NodeInstallStatus.FAILED,
] as const;

export class ReportNodeInstallProgressDto {
  @ApiProperty({
    example: 'nrygC4WefXwkwUfYx3Lx4Wq4vL99b2WGdo6Ru8a11ug',
  })
  @Transform(({ value }) => value?.trim())
  @IsString()
  @MinLength(8)
  token: string;

  @ApiProperty({
    example: 'binary_downloaded',
  })
  @Transform(({ value }) => value?.trim())
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  stage: string;

  @ApiPropertyOptional({
    enum: REPORTABLE_NODE_INSTALL_STATUSES,
    example: NodeInstallStatus.INSTALLING,
  })
  @IsOptional()
  @IsIn(REPORTABLE_NODE_INSTALL_STATUSES)
  status?: NodeInstallStatus;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: 100,
    example: 72,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  progressPercent?: number;

  @ApiPropertyOptional({
    example: 'Agent binary downloaded. Bootstrapping node credentials next.',
  })
  @IsOptional()
  @Transform(({ value }) => value?.trim())
  @IsString()
  @MaxLength(500)
  statusMessage?: string;
}
