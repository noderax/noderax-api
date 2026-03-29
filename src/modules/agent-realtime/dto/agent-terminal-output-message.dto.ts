import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBase64, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class AgentTerminalOutputMessageDto {
  @ApiPropertyOptional({
    example: 'terminal.output',
  })
  @IsOptional()
  @IsString()
  @IsIn(['terminal.output'])
  type?: 'terminal.output';

  @IsUUID()
  sessionId: string;

  @IsIn(['stdout', 'stderr', 'system'])
  direction: 'stdout' | 'stderr' | 'system';

  @IsBase64()
  @MaxLength(65536)
  payload: string;

  @IsOptional()
  @IsString()
  timestamp?: string;
}
