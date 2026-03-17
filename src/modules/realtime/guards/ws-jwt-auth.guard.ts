import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { REALTIME_ERROR_CODES } from '../../../common/constants/realtime.constants';
import { AuthenticatedSocket } from '../../../common/types/authenticated-socket.type';

@Injectable()
export class WsJwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const client = context.switchToWs().getClient<AuthenticatedSocket>();

    if (!client.data.user) {
      throw new WsException({
        code: REALTIME_ERROR_CODES.UNAUTHORIZED,
        message: 'Authentication required for realtime subscriptions',
      });
    }

    return true;
  }
}
