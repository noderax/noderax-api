import {
  ApiProperty,
  ApiPropertyOptional,
  getSchemaPath,
} from '@nestjs/swagger';
import { AGENT_RELEASE_CHANNELS } from '../entities/agent-update-statuses';

export class AgentReleaseArtifactDto {
  @ApiProperty({
    example:
      'https://cdn.noderax.net/noderax-agent/releases/1.0.1/noderax-agent-linux-amd64',
  })
  binaryUrl: string;

  @ApiProperty({
    example: 'ef797c8118f02dfb649607dd5d3f8c762c5c7f7a7d6efc7c17b1d7b729ac79b8',
  })
  sha256: string;
}

export class AgentReleaseNotesSectionDto {
  @ApiProperty({
    example: 'Added',
  })
  title: string;

  @ApiProperty({
    type: String,
    isArray: true,
    example: ['Fleet update orchestration for Linux amd64 and arm64 nodes.'],
  })
  items: string[];
}

export class AgentReleaseArtifactsDto {
  @ApiPropertyOptional({
    type: AgentReleaseArtifactDto,
  })
  amd64?: AgentReleaseArtifactDto;

  @ApiPropertyOptional({
    type: AgentReleaseArtifactDto,
  })
  arm64?: AgentReleaseArtifactDto;
}

export class AgentReleaseDto {
  @ApiProperty({
    example: '1.0.1',
  })
  version: string;

  @ApiProperty({
    format: 'date-time',
    example: '2026-04-01T17:00:00.000Z',
  })
  publishedAt: string;

  @ApiProperty({
    example: '4b825dc642cb6eb9a060e54bf8d69288fbee4904',
  })
  commit: string;

  @ApiProperty({
    enum: AGENT_RELEASE_CHANNELS,
    example: 'tag',
  })
  channel: 'tag';

  @ApiProperty({
    type: 'array',
    items: { $ref: getSchemaPath(AgentReleaseNotesSectionDto) },
  })
  notes: AgentReleaseNotesSectionDto[];

  @ApiProperty({
    type: AgentReleaseArtifactsDto,
  })
  artifacts: AgentReleaseArtifactsDto;
}
