import { Socket } from 'socket.io';
import { AuthenticatedUser } from './authenticated-user.type';

export interface AuthenticatedSocketData {
  user: AuthenticatedUser;
  terminalSessionAuth?: {
    sessionId: string;
    workspaceId: string;
  };
}

export type AuthenticatedSocket = Socket<
  Record<string, never>,
  Record<string, never>,
  Record<string, never>,
  AuthenticatedSocketData
>;
