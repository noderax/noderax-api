import { IsUUID } from 'class-validator';

export class TerminalAttachMessageDto {
  @IsUUID()
  sessionId: string;
}
