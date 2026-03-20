import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsString } from 'class-validator';
import { AgentMetricsDto } from '../../metrics/dto/agent-metrics.dto';

export class AgentMetricsMessageDto extends AgentMetricsDto {
  @ApiProperty({
    example: 'agent.metrics',
  })
  @IsString()
  @IsIn(['agent.metrics'])
  type: 'agent.metrics';

  @ApiPropertyOptional({
    format: 'date-time',
    example: '2026-03-20T18:20:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  timestamp?: string;
}
