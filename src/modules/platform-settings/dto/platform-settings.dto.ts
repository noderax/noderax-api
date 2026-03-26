import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PlatformAppSettingsDto {
  @ApiProperty({ example: '*' })
  @IsString()
  corsOrigin: string;

  @ApiProperty({ example: true })
  @Type(() => Boolean)
  @IsBoolean()
  swaggerEnabled: boolean;

  @ApiProperty({ example: 'docs' })
  @IsString()
  @MinLength(1)
  swaggerPath: string;
}

export class PlatformDatabaseSettingsDto {
  @ApiProperty({ example: 'postgres' })
  @IsString()
  @MinLength(1)
  host: string;

  @ApiProperty({ example: 5432 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  port: number;

  @ApiProperty({ example: 'postgres' })
  @IsString()
  @MinLength(1)
  username: string;

  @ApiProperty({ example: 'postgres' })
  @IsString()
  password: string;

  @ApiProperty({ example: 'noderax' })
  @IsString()
  @MinLength(1)
  database: string;

  @ApiProperty({ example: false })
  @Type(() => Boolean)
  @IsBoolean()
  synchronize: boolean;

  @ApiProperty({ example: false })
  @Type(() => Boolean)
  @IsBoolean()
  logging: boolean;

  @ApiProperty({ example: false })
  @Type(() => Boolean)
  @IsBoolean()
  ssl: boolean;
}

export class PlatformRedisSettingsDto {
  @ApiProperty({ example: true })
  @Type(() => Boolean)
  @IsBoolean()
  enabled: boolean;

  @ApiProperty({ example: '' })
  @IsString()
  url: string;

  @ApiProperty({ example: 'redis' })
  @IsString()
  host: string;

  @ApiProperty({ example: 6379 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  port: number;

  @ApiProperty({ example: '' })
  @IsString()
  password: string;

  @ApiProperty({ example: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  db: number;

  @ApiProperty({ example: 'noderax:' })
  @IsString()
  keyPrefix: string;
}

export class PlatformAuthSettingsDto {
  @ApiProperty({ example: 'super-secret-jwt-key-change-me-in-production' })
  @IsString()
  @MinLength(1)
  jwtSecret: string;

  @ApiProperty({ example: '1d' })
  @IsString()
  @MinLength(1)
  jwtExpiresIn: string;

  @ApiProperty({ example: 12 })
  @Type(() => Number)
  @IsInt()
  @Min(10)
  bcryptSaltRounds: number;
}

export class PlatformAgentSettingsDto {
  @ApiProperty({ example: 90 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  heartbeatTimeoutSeconds: number;

  @ApiProperty({ example: 90 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  offlineCheckIntervalSeconds: number;

  @ApiProperty({ example: 45 })
  @Type(() => Number)
  @IsInt()
  @Min(15)
  realtimePingTimeoutSeconds: number;

  @ApiProperty({ example: 5 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  realtimePingCheckIntervalSeconds: number;

  @ApiProperty({ example: 60 })
  @Type(() => Number)
  @IsInt()
  @Min(15)
  taskClaimLeaseSeconds: number;

  @ApiProperty({ example: 15 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  staleTaskCheckIntervalSeconds: number;

  @ApiProperty({ example: 120 })
  @Type(() => Number)
  @IsInt()
  @Min(5)
  staleQueuedTaskTimeoutSeconds: number;

  @ApiProperty({ example: 1800 })
  @Type(() => Number)
  @IsInt()
  @Min(10)
  staleRunningTaskTimeoutSeconds: number;

  @ApiProperty({ example: false })
  @Type(() => Boolean)
  @IsBoolean()
  enableRealtimeTaskDispatch: boolean;

  @ApiProperty({ example: 'change-me-agent-enrollment-token' })
  @IsString()
  @MinLength(1)
  enrollmentToken: string;

  @ApiProperty({ example: 90 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  highCpuThreshold: number;
}

export class PlatformSettingsValuesDto {
  @ApiProperty({ type: PlatformAppSettingsDto })
  @Type(() => PlatformAppSettingsDto)
  @ValidateNested()
  app: PlatformAppSettingsDto;

  @ApiProperty({ type: PlatformDatabaseSettingsDto })
  @Type(() => PlatformDatabaseSettingsDto)
  @ValidateNested()
  database: PlatformDatabaseSettingsDto;

  @ApiProperty({ type: PlatformRedisSettingsDto })
  @Type(() => PlatformRedisSettingsDto)
  @ValidateNested()
  redis: PlatformRedisSettingsDto;

  @ApiProperty({ type: PlatformAuthSettingsDto })
  @Type(() => PlatformAuthSettingsDto)
  @ValidateNested()
  auth: PlatformAuthSettingsDto;

  @ApiProperty({ type: PlatformAgentSettingsDto })
  @Type(() => PlatformAgentSettingsDto)
  @ValidateNested()
  agents: PlatformAgentSettingsDto;
}

export class PlatformSettingsResponseDto extends PlatformSettingsValuesDto {
  @ApiProperty({
    enum: ['install_state', 'process_env'],
    example: 'install_state',
  })
  source: 'install_state' | 'process_env';

  @ApiProperty({ example: true })
  editable: boolean;

  @ApiProperty({ example: false })
  restartRequired: boolean;

  @ApiPropertyOptional({
    nullable: true,
    example:
      'Changes are written to installer state and will apply after the API restarts.',
  })
  message: string | null;
}

export class UpdatePlatformSettingsDto extends PlatformSettingsValuesDto {}
