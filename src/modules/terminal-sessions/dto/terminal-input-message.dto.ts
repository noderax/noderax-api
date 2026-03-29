import { IsBase64, IsUUID, MaxLength } from 'class-validator';

export class TerminalInputMessageDto {
  @IsUUID()
  sessionId: string;

  @IsBase64()
  @MaxLength(32768)
  payload: string;
}
