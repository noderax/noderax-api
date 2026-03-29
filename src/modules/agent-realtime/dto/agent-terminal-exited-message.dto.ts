import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class AgentTerminalExitedMessageDto {
  @ApiPropertyOptional({
    example: 'terminal.exited',
  })
  @IsOptional()
  @IsString()
  @IsIn(['terminal.exited'])
  type?: 'terminal.exited';

  @IsUUID()
  sessionId: string;

  @IsOptional()
  @IsInt()
  exitCode?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string | null;

  @IsOptional()
  @IsString()
  timestamp?: string;
}
