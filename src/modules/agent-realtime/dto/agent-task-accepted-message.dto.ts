import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class AgentTaskAcceptedMessageDto {
  @ApiPropertyOptional({
    example: 'task.accepted',
  })
  @IsOptional()
  @IsString()
  @IsIn(['task.accepted'])
  type?: 'task.accepted';

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Optional transport metadata from agents. Not used for auth in lifecycle handlers.',
  })
  @IsOptional()
  @IsUUID()
  nodeId?: string;

  @ApiPropertyOptional({
    description:
      'Optional transport metadata from agents. Not used for auth in lifecycle handlers.',
  })
  @IsOptional()
  @IsString()
  agentToken?: string;

  @ApiProperty({
    format: 'uuid',
    example: 'ec9f97f2-7b56-4a7e-a7cb-5c957e9d32d8',
  })
  @IsUUID()
  taskId: string;

  @ApiPropertyOptional({
    format: 'date-time',
    example: '2026-03-20T18:20:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  timestamp?: string;
}
