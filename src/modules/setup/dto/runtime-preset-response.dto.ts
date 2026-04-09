import { ApiProperty } from '@nestjs/swagger';
import { ApiPropertyOptional } from '@nestjs/swagger';

class SetupRuntimeEditableFieldsDto {
  @ApiProperty({ example: true })
  postgres: boolean;

  @ApiProperty({ example: true })
  redis: boolean;

  @ApiProperty({ example: true })
  mail: boolean;

  @ApiProperty({ example: false })
  publicOrigin: boolean;
}

class SetupRuntimePostgresPresetDto {
  @ApiProperty({ example: 'postgres' })
  host: string;

  @ApiProperty({ example: 5432 })
  port: number;

  @ApiProperty({ example: 'postgres' })
  username: string;

  @ApiPropertyOptional({ example: 'generated-local-password' })
  password?: string;

  @ApiProperty({ example: 'noderax' })
  database: string;

  @ApiProperty({ example: false })
  ssl: boolean;
}

class SetupRuntimeRedisPresetDto {
  @ApiProperty({ example: 'redis' })
  host: string;

  @ApiProperty({ example: 6379 })
  port: number;

  @ApiProperty({ example: 0 })
  db: number;

  @ApiPropertyOptional({ example: 'generated-local-password' })
  password?: string;
}

export class RuntimePresetResponseDto {
  @ApiProperty({ enum: ['local_bundle', 'manual'], example: 'local_bundle' })
  mode: 'local_bundle' | 'manual';

  @ApiProperty({ example: 'http://noderax.local' })
  publicOrigin: string | null;

  @ApiProperty({ type: SetupRuntimePostgresPresetDto })
  postgresPreset: SetupRuntimePostgresPresetDto;

  @ApiProperty({ type: SetupRuntimeRedisPresetDto })
  redisPreset: SetupRuntimeRedisPresetDto;

  @ApiProperty({ type: SetupRuntimeEditableFieldsDto })
  editableFields: SetupRuntimeEditableFieldsDto;
}
