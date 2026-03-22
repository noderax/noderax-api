import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedAgent } from '../types/authenticated-agent.type';

export const CurrentAgent = createParamDecorator(
  (
    _data: unknown,
    context: ExecutionContext,
  ): AuthenticatedAgent | undefined => {
    const request = context.switchToHttp().getRequest();
    return request.agent as AuthenticatedAgent | undefined;
  },
);
