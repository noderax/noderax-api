import { ApiProperty } from '@nestjs/swagger';

export class DependencyCheckDto {
  @ApiProperty({ example: true })
  healthy: boolean;

  @ApiProperty({ example: 'ready' })
  status: string;

  @ApiProperty({ example: null, nullable: true })
  detail: string | null;
}

export class DependencyHealthChecksDto {
  @ApiProperty({ type: () => DependencyCheckDto })
  database: DependencyCheckDto;

  @ApiProperty({ type: () => DependencyCheckDto })
  redis: DependencyCheckDto;

  @ApiProperty({ type: () => DependencyCheckDto })
  installState: DependencyCheckDto;

  @ApiProperty({ type: () => DependencyCheckDto })
  migrations: DependencyCheckDto;
}

export class DependencyHealthResponseDto {
  @ApiProperty({ example: 'noderax-api' })
  service: string;

  @ApiProperty({ example: 'ok' })
  status: string;

  @ApiProperty({ format: 'date-time' })
  timestamp: string;

  @ApiProperty({ type: () => DependencyHealthChecksDto })
  checks: DependencyHealthChecksDto;
}

export class ReadinessResponseDto extends DependencyHealthResponseDto {
  @ApiProperty({ example: true })
  ready: boolean;
}
