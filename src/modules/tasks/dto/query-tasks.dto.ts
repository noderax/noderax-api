import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { TaskStatus } from '../entities/task-status.enum';

export class QueryTasksDto {
  @IsOptional()
  @IsUUID()
  nodeId?: string;

  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;
}
