import { ApiHideProperty } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsUUID } from 'class-validator';
import { AgentTaskAuthDto } from './agent-task-auth.dto';

export class StartAgentTaskDto extends AgentTaskAuthDto {
  @ApiHideProperty()
  @IsOptional()
  @IsUUID()
  taskId?: string;

  @ApiHideProperty()
  @IsOptional()
  @IsDateString()
  startedAt?: string;
}
