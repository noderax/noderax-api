import { IsEnum, IsOptional, IsString } from 'class-validator';
import { NodeStatus } from '../entities/node-status.enum';

export class QueryNodesDto {
  @IsOptional()
  @IsEnum(NodeStatus)
  status?: NodeStatus;

  @IsOptional()
  @IsString()
  search?: string;
}
