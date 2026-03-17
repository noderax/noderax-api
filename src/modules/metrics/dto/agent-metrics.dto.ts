import {
  IsNumber,
  IsObject,
  IsString,
  IsUUID,
  Max,
  Min,
  MinLength,
} from 'class-validator';

export class AgentMetricsDto {
  @IsUUID()
  nodeId: string;

  @IsString()
  @MinLength(32)
  agentToken: string;

  @IsNumber()
  @Min(0)
  @Max(100)
  cpuUsage: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  memoryUsage: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  diskUsage: number;

  @IsObject()
  networkStats: Record<string, unknown>;
}
