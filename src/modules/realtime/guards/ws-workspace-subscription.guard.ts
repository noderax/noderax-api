import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { REALTIME_ERROR_CODES } from '../../../common/constants/realtime.constants';
import { AuthenticatedSocket } from '../../../common/types/authenticated-socket.type';
import { RealtimeAuthorizationService } from '../services/realtime-authorization.service';

@Injectable()
export class WsWorkspaceSubscriptionGuard implements CanActivate {
  constructor(
    private readonly realtimeAuthorizationService: RealtimeAuthorizationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const client = context.switchToWs().getClient<AuthenticatedSocket>();
    const payload = context.switchToWs().getData<{ workspaceId?: string }>();
    const user = client.data.user;

    if (!user) {
      throw new WsException({
        code: REALTIME_ERROR_CODES.UNAUTHORIZED,
        message: 'Authentication required for realtime subscriptions',
      });
    }

    if (!payload?.workspaceId || typeof payload.workspaceId !== 'string') {
      throw new WsException({
        code: REALTIME_ERROR_CODES.BAD_REQUEST,
        message: 'workspaceId is required for workspace subscriptions',
      });
    }

    try {
      await this.realtimeAuthorizationService.assertCanAccessWorkspace(
        user,
        payload.workspaceId,
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
      message: 'Unable to authorize workspace subscription',
    });
  }
}
