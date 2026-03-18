import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsUUID } from 'class-validator';
import { AgentTaskAuthDto } from './agent-task-auth.dto';

export class StartAgentTaskDto extends AgentTaskAuthDto {
  @ApiPropertyOptional({
    format: 'uuid',
    example: 'ec9f97f2-7b56-4a7e-a7cb-5c957e9d32d8',
    description:
      'Optional task identifier echoed by the agent. Must match the route parameter when provided.',
  })
  @IsOptional()
  @IsUUID()
  taskId?: string;

  @ApiPropertyOptional({
    format: 'date-time',
    example: '2026-03-18T10:18:00.000Z',
    description:
      'Optional agent-side timestamp describing when execution began.',
  })
  @IsOptional()
  @IsDateString()
  startedAt?: string;
}
