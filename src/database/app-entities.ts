import { AuditLogEntity } from '../modules/audit-logs/entities/audit-log.entity';
import { OidcIdentityEntity } from '../modules/auth/entities/oidc-identity.entity';
import { OidcProviderEntity } from '../modules/auth/entities/oidc-provider.entity';
import { AgentTaskLifecycleEventEntity } from '../modules/agent-realtime/entities/agent-task-lifecycle-event.entity';
import { EnrollmentEntity } from '../modules/enrollments/entities/enrollment.entity';
import { EventEntity } from '../modules/events/entities/event.entity';
import { MetricEntity } from '../modules/metrics/entities/metric.entity';
import { NodeEntity } from '../modules/nodes/entities/node.entity';
import { ScheduledTaskEntity } from '../modules/tasks/entities/scheduled-task.entity';
import { TaskLogEntity } from '../modules/tasks/entities/task-log.entity';
import { TaskEntity } from '../modules/tasks/entities/task.entity';
import { TaskTemplateEntity } from '../modules/tasks/entities/task-template.entity';
import { PasswordResetTokenEntity } from '../modules/users/entities/password-reset-token.entity';
import { UserInvitationEntity } from '../modules/users/entities/user-invitation.entity';
import { UserEntity } from '../modules/users/entities/user.entity';
import { TeamMembershipEntity } from '../modules/workspaces/entities/team-membership.entity';
import { TeamEntity } from '../modules/workspaces/entities/team.entity';
import { WorkspaceMembershipEntity } from '../modules/workspaces/entities/workspace-membership.entity';
import { WorkspaceEntity } from '../modules/workspaces/entities/workspace.entity';

export const APP_ENTITIES = [
  AuditLogEntity,
  UserEntity,
  UserInvitationEntity,
  PasswordResetTokenEntity,
  WorkspaceEntity,
  WorkspaceMembershipEntity,
  TeamEntity,
  TeamMembershipEntity,
  NodeEntity,
  TaskEntity,
  TaskLogEntity,
  TaskTemplateEntity,
  ScheduledTaskEntity,
  EventEntity,
  MetricEntity,
  EnrollmentEntity,
  OidcProviderEntity,
  OidcIdentityEntity,
  AgentTaskLifecycleEventEntity,
] as const;
