import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsString } from 'class-validator';

export class AgentPingMessageDto {
  @ApiPropertyOptional({
    example: 'agent.ping',
  })
  @IsString()
  @IsIn(['agent.ping'])
  type: 'agent.ping';

  @ApiPropertyOptional({
    format: 'date-time',
    example: '2026-03-20T18:20:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  timestamp?: string;
}
