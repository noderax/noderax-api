import { Transform, Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { clampInteger } from '../../../common/utils/clamp-integer.util';
import { TaskStatus } from '../entities/task-status.enum';

export class QueryTasksDto {
  @ApiPropertyOptional({
    format: 'uuid',
    example: 'b7f88611-b63e-4c95-9f37-4afb5c0cf275',
  })
  @IsOptional()
  @IsUUID()
  nodeId?: string;

  @ApiPropertyOptional({
    enum: TaskStatus,
    enumName: 'TaskStatus',
    example: TaskStatus.QUEUED,
  })
  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

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
