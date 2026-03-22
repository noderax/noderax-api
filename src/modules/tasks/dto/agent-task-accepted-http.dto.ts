import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsUUID } from 'class-validator';

export class AgentTaskAcceptedHttpDto {
  @ApiPropertyOptional({
    format: 'uuid',
    example: 'ec9f97f2-7b56-4a7e-a7cb-5c957e9d32d8',
    description: 'Must match route taskId when provided.',
  })
  @IsOptional()
  @IsUUID()
  taskId?: string;

  @ApiPropertyOptional({
    format: 'date-time',
    example: '2026-03-22T16:47:29.206Z',
  })
  @IsOptional()
  @IsDateString()
  timestamp?: string;
}
