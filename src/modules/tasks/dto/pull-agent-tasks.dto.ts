import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { clampInteger } from '../../../common/utils/clamp-integer.util';
import { AgentTaskAuthDto } from './agent-task-auth.dto';

export class PullAgentTasksDto extends AgentTaskAuthDto {
  @ApiPropertyOptional({
    example: 10,
    minimum: 1,
    maximum: 100,
    default: 10,
  })
  @IsOptional()
  @Transform(({ value }) => clampInteger(value, { min: 1, max: 100 }))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
