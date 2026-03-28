import { Transform, Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { clampInteger } from '../../../common/utils/clamp-integer.util';
import { NodeStatus } from '../entities/node-status.enum';

export class QueryNodesDto {
  @ApiPropertyOptional({
    enum: NodeStatus,
    enumName: 'NodeStatus',
    example: NodeStatus.ONLINE,
  })
  @IsOptional()
  @IsEnum(NodeStatus)
  status?: NodeStatus;

  @ApiPropertyOptional({
    example: 'srv',
    description: 'Free-text search against node name and hostname.',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  teamId?: string;

  @ApiPropertyOptional({
    description: 'Filter nodes currently in maintenance mode.',
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  maintenanceMode?: boolean;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 100,
    default: 50,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Transform(({ value }) => clampInteger(value, { min: 1, max: 100 }))
  limit?: number;

  @ApiPropertyOptional({
    minimum: 0,
    default: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  offset?: number;
}
