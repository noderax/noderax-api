import { SetMetadata } from '@nestjs/common';
import { WorkspaceMembershipRole } from '../../modules/workspaces/entities/workspace-membership-role.enum';

export const WORKSPACE_ROLES_KEY = 'workspace_roles';

export const WorkspaceRoles = (...roles: WorkspaceMembershipRole[]) =>
  SetMetadata(WORKSPACE_ROLES_KEY, roles);
