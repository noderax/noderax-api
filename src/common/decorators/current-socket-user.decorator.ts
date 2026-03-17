import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedSocket } from '../types/authenticated-socket.type';
import { AuthenticatedUser } from '../types/authenticated-user.type';

export const CurrentSocketUser = createParamDecorator(
  (
    _data: unknown,
    context: ExecutionContext,
  ): AuthenticatedUser | undefined => {
    const client = context.switchToWs().getClient<AuthenticatedSocket>();
    return client.data.user;
  },
);
