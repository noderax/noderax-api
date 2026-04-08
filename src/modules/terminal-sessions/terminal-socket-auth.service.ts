import { Injectable } from '@nestjs/common';
import { Socket } from 'socket.io';
import { AuthenticatedUser } from '../../common/types/authenticated-user.type';
import { AuthService } from '../auth/auth.service';

type AuthenticatedTerminalSocket = {
  user: AuthenticatedUser;
  sessionId: string;
  workspaceId: string;
};

@Injectable()
export class TerminalSocketAuthService {
  constructor(private readonly authService: AuthService) {}

  async authenticateSocket(
    client: Socket,
  ): Promise<AuthenticatedTerminalSocket> {
    const accessToken = this.extractAccessToken(client);

    if (!accessToken) {
      throw new Error('Missing authentication token');
    }

    return this.authService.verifyTerminalConnectToken(accessToken);
  }

  private extractAccessToken(client: Socket): string | null {
    const handshakeAuth = client.handshake.auth as
      | Record<string, unknown>
      | undefined;
    const tokenFromAuth = this.normalizeToken(
      handshakeAuth?.token ??
        handshakeAuth?.accessToken ??
        handshakeAuth?.authorization,
    );

    if (tokenFromAuth) {
      return tokenFromAuth;
    }

    const authorizationHeader = client.handshake.headers.authorization;
    return this.normalizeToken(
      Array.isArray(authorizationHeader)
        ? authorizationHeader[0]
        : authorizationHeader,
    );
  }

  private normalizeToken(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const trimmedValue = value.trim();
    if (!trimmedValue) {
      return null;
    }

    if (trimmedValue.toLowerCase().startsWith('bearer ')) {
      const bearerToken = trimmedValue.slice(7).trim();
      return bearerToken || null;
    }

    return trimmedValue;
  }
}
