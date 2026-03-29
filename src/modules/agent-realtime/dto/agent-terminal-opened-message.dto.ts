import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class AgentTerminalOpenedMessageDto {
  @ApiPropertyOptional({
    example: 'terminal.opened',
  })
  @IsOptional()
  @IsString()
  @IsIn(['terminal.opened'])
  type?: 'terminal.opened';

  @IsUUID()
  sessionId: string;

  @IsOptional()
  @IsString()
  timestamp?: string;

  @IsOptional()
  @IsInt()
  @Min(20)
  @Max(400)
  cols?: number;

  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(200)
  rows?: number;
}
