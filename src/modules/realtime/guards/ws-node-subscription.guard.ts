import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { REALTIME_ERROR_CODES } from '../../../common/constants/realtime.constants';
import { AuthenticatedSocket } from '../../../common/types/authenticated-socket.type';
import { RealtimeAuthorizationService } from '../services/realtime-authorization.service';

@Injectable()
export class WsNodeSubscriptionGuard implements CanActivate {
  constructor(
    private readonly realtimeAuthorizationService: RealtimeAuthorizationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const client = context.switchToWs().getClient<AuthenticatedSocket>();
    const payload = context.switchToWs().getData<{ nodeId?: string }>();
    const user = client.data.user;

    if (!user) {
      throw new WsException({
        code: REALTIME_ERROR_CODES.UNAUTHORIZED,
        message: 'Authentication required for realtime subscriptions',
      });
    }

    if (!payload?.nodeId || typeof payload.nodeId !== 'string') {
      throw new WsException({
        code: REALTIME_ERROR_CODES.BAD_REQUEST,
        message: 'nodeId is required for node subscriptions',
      });
    }

    try {
      await this.realtimeAuthorizationService.assertCanAccessNode(
        user,
        payload.nodeId,
      );
    } catch (error) {
      throw this.toWsException(error);
    }

    return true;
  }

  private toWsException(error: unknown): WsException {
    if (error instanceof Error && error.name === 'NotFoundException') {
      return new WsException({
        code: REALTIME_ERROR_CODES.NOT_FOUND,
        message: error.message,
      });
    }

    if (
      error instanceof Error &&
      (error.name === 'ForbiddenException' ||
        error.name === 'UnauthorizedException')
    ) {
      return new WsException({
        code: REALTIME_ERROR_CODES.FORBIDDEN,
        message: error.message,
      });
    }

    return new WsException({
      code: REALTIME_ERROR_CODES.FORBIDDEN,
      message: 'Unable to authorize node subscription',
    });
  }
}
