import {
  IsArray,
  IsDateString,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AgentMetricsDto {
  @ApiProperty({
    format: 'uuid',
    example: 'b7f88611-b63e-4c95-9f37-4afb5c0cf275',
  })
  @IsUUID()
  nodeId: string;

  @ApiProperty({
    example: '8eb84760b145bd1805e87ef4c0947b7b142d1bed3428f70f9b5f6f0a11baeb42',
    minLength: 32,
  })
  @IsString()
  @MinLength(32)
  agentToken: string;

  @ApiProperty({
    example: 42.5,
    minimum: 0,
    maximum: 100,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  cpuUsage?: number;

  @ApiProperty({
    example: 63.1,
    minimum: 0,
    maximum: 100,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  memoryUsage?: number;

  @ApiProperty({
    example: 58.4,
    minimum: 0,
    maximum: 100,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  diskUsage?: number;

  @ApiProperty({
    example: {
      rxBytes: 124000,
      txBytes: 98000,
      rxPackets: 450,
      txPackets: 430,
    },
    type: 'object',
    additionalProperties: true,
  })
  @IsOptional()
  @IsObject()
  networkStats?: Record<string, unknown>;

  @ApiPropertyOptional({
    format: 'date-time',
    example: '2026-03-18T10:15:30.000Z',
    description:
      'Optional collection timestamp emitted by the agent alongside the metrics snapshot.',
  })
  @IsOptional()
  @IsDateString()
  collectedAt?: string;

  @ApiPropertyOptional({
    example: { usagePercent: 12.5 },
    type: 'object',
    additionalProperties: true,
    description:
      'Go-agent compatible CPU payload. usagePercent is mapped to cpuUsage.',
  })
  @IsOptional()
  @IsObject()
  cpu?: Record<string, unknown>;

  @ApiPropertyOptional({
    example: { usedPercent: 33.3, totalBytes: 1024 },
    type: 'object',
    additionalProperties: true,
    description:
      'Go-agent compatible memory payload. usedPercent is mapped to memoryUsage.',
  })
  @IsOptional()
  @IsObject()
  memory?: Record<string, unknown>;

  @ApiPropertyOptional({
    example: { usedPercent: 44.4, path: '/' },
    type: 'object',
    additionalProperties: true,
    description:
      'Go-agent compatible disk payload. usedPercent is mapped to diskUsage.',
  })
  @IsOptional()
  @IsObject()
  disk?: Record<string, unknown>;

  @ApiPropertyOptional({
    example: [
      {
        interface: 'eth0',
        bytesSent: 2000,
        bytesRecv: 1000,
      },
    ],
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: true,
    },
    description:
      'Go-agent compatible per-interface metrics. They are summarized into networkStats.',
  })
  @IsOptional()
  @IsArray()
  @IsObject({ each: true })
  networks?: Array<Record<string, unknown>>;
}
