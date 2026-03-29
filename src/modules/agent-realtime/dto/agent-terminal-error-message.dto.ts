import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class AgentTerminalErrorMessageDto {
  @ApiPropertyOptional({
    example: 'terminal.error',
  })
  @IsOptional()
  @IsString()
  @IsIn(['terminal.error'])
  type?: 'terminal.error';

  @IsUUID()
  sessionId: string;

  @IsString()
  @MaxLength(1000)
  message: string;

  @IsOptional()
  @IsString()
  timestamp?: string;
}
