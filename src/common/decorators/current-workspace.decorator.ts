import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { WorkspaceEntity } from '../../modules/workspaces/entities/workspace.entity';

export const CurrentWorkspace = createParamDecorator(
  (_data: unknown, context: ExecutionContext): WorkspaceEntity | undefined => {
    const request = context.switchToHttp().getRequest();
    return request.workspace as WorkspaceEntity | undefined;
  },
);
