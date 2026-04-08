import { ApiProperty } from '@nestjs/swagger';
import { TerminalSessionEntity } from '../entities/terminal-session.entity';

export class TerminalSessionConnectResponseDto extends TerminalSessionEntity {
  @ApiProperty({
    description:
      'Short-lived websocket capability token scoped to this terminal session.',
  })
  terminalConnectToken: string;

  @ApiProperty({
    format: 'date-time',
    description: 'Expiry timestamp for the terminal websocket token.',
  })
  terminalConnectExpiresAt: string;
}

export class TerminalSessionConnectTokenDto {
  @ApiProperty({ format: 'uuid' })
  sessionId: string;

  @ApiProperty({
    description:
      'Short-lived websocket capability token scoped to this terminal session.',
  })
  terminalConnectToken: string;

  @ApiProperty({
    format: 'date-time',
    description: 'Expiry timestamp for the terminal websocket token.',
  })
  terminalConnectExpiresAt: string;
}
