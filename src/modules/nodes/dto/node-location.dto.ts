import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export const NODE_LOCATION_PROVIDERS = ['aws', 'gcp', 'azure'] as const;
export const NODE_LOCATION_SOURCES = ['cloud_metadata'] as const;

export type NodeLocationProvider = (typeof NODE_LOCATION_PROVIDERS)[number];
export type NodeLocationSource = (typeof NODE_LOCATION_SOURCES)[number];

export class AgentNodeLocationDto {
  @ApiProperty({
    enum: NODE_LOCATION_PROVIDERS,
    example: 'aws',
  })
  @IsString()
  @IsIn(NODE_LOCATION_PROVIDERS)
  provider: NodeLocationProvider;

  @ApiProperty({
    enum: NODE_LOCATION_SOURCES,
    example: 'cloud_metadata',
  })
  @IsString()
  @IsIn(NODE_LOCATION_SOURCES)
  source: NodeLocationSource;

  @ApiProperty({
    example: 'eu-central-1',
    description: 'Cloud provider region code reported by the agent.',
  })
  @IsString()
  @MinLength(2)
  region: string;

  @ApiPropertyOptional({
    example: 'eu-central-1a',
    nullable: true,
    description: 'Optional cloud availability zone reported by the agent.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  zone?: string;
}

export class NodeLocationDto extends AgentNodeLocationDto {
  @ApiPropertyOptional({
    example: 50.1109,
    nullable: true,
    description:
      'Approximate latitude for the cloud region center. Null when the region is unknown.',
  })
  latitude: number | null;

  @ApiPropertyOptional({
    example: 8.6821,
    nullable: true,
    description:
      'Approximate longitude for the cloud region center. Null when the region is unknown.',
  })
  longitude: number | null;

  @ApiPropertyOptional({
    format: 'date-time',
    nullable: true,
  })
  updatedAt: Date | null;
}
