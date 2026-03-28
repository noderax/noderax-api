import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuthenticatedUser } from '../types/authenticated-user.type';
import { UserRole } from '../../modules/users/entities/user-role.enum';
import { WorkspacesService } from '../../modules/workspaces/workspaces.service';

@Injectable()
export class WorkspaceMembershipGuard implements CanActivate {
  constructor(private readonly workspacesService: WorkspacesService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser | undefined;
    const workspaceId = request.params?.workspaceId as string | undefined;

    if (!user || !workspaceId) {
      throw new NotFoundException('Workspace context was not provided.');
    }

    const workspace = await this.workspacesService.findWorkspaceForUserOrFail(
      workspaceId,
      user,
    );

    request.workspace = workspace;
    request.workspaceMembership =
      user.role === UserRole.PLATFORM_ADMIN
        ? null
        : await this.workspacesService.findMembershipForUser(
            workspaceId,
            user.id,
          );

    return true;
  }
}
