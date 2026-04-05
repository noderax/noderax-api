import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsOptional, IsString } from 'class-validator';
import {
  NODE_ROOT_ACCESS_PROFILES,
  NodeRootAccessProfile,
} from '../entities/node-root-access-profile.enum';

export class NodeRootAccessDesiredSnapshotDto {
  @ApiProperty({
    enum: NODE_ROOT_ACCESS_PROFILES,
    example: NodeRootAccessProfile.OFF,
  })
  @IsIn(NODE_ROOT_ACCESS_PROFILES)
  profile: NodeRootAccessProfile;

  @ApiPropertyOptional({
    format: 'date-time',
    nullable: true,
  })
  @IsOptional()
  @IsISO8601()
  updatedAt?: string | null;
}

export class NodeRootAccessAgentReportDto {
  @ApiPropertyOptional({
    enum: NODE_ROOT_ACCESS_PROFILES,
    example: NodeRootAccessProfile.OFF,
  })
  @IsOptional()
  @IsIn(NODE_ROOT_ACCESS_PROFILES)
  appliedProfile?: NodeRootAccessProfile;

  @ApiPropertyOptional({
    format: 'date-time',
    nullable: true,
  })
  @IsOptional()
  @IsISO8601()
  lastAppliedAt?: string | null;

  @ApiPropertyOptional({
    nullable: true,
  })
  @IsOptional()
  @IsString()
  lastError?: string | null;
}
