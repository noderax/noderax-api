import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class TerminalTerminateMessageDto {
  @IsUUID()
  sessionId: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
