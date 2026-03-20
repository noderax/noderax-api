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
  @IsString()
  @IsIn(['task.accepted'])
  type: 'task.accepted';

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
