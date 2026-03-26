import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { WORKSPACE_ROLES_KEY } from '../decorators/workspace-roles.decorator';
import { AuthenticatedUser } from '../types/authenticated-user.type';
import { UserRole } from '../../modules/users/entities/user-role.enum';
import { WorkspaceMembershipEntity } from '../../modules/workspaces/entities/workspace-membership.entity';
import { WorkspaceMembershipRole } from '../../modules/workspaces/entities/workspace-membership-role.enum';

@Injectable()
export class WorkspaceRolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles =
      this.reflector.getAllAndOverride<WorkspaceMembershipRole[]>(
        WORKSPACE_ROLES_KEY,
        [context.getHandler(), context.getClass()],
      );

    if (!requiredRoles?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser | undefined;
    const membership = request.workspaceMembership as
      | WorkspaceMembershipEntity
      | null
      | undefined;

    if (!user) {
      return false;
    }

    if (user.role === UserRole.PLATFORM_ADMIN) {
      return true;
    }

    return !!membership && requiredRoles.includes(membership.role);
  }
}
