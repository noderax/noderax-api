import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
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
}
