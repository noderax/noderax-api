import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class AgentTaskLogMessageDto {
  @ApiPropertyOptional({
    example: 'task.log',
  })
  @IsOptional()
  @IsString()
  @IsIn(['task.log'])
  type?: 'task.log';

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

  @ApiProperty({
    example: 'stdout',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  stream: string;

  @ApiProperty({
    example: 'Pulling latest image digest...',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  line: string;

  @ApiPropertyOptional({
    format: 'date-time',
    example: '2026-03-18T10:18:05.000Z',
  })
  @IsOptional()
  @IsDateString()
  timestamp?: string;
}
