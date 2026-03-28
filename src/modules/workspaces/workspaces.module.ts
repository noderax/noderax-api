import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkspaceMembershipGuard } from '../../common/guards/workspace-membership.guard';
import { WorkspaceRolesGuard } from '../../common/guards/workspace-roles.guard';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { EventEntity } from '../events/entities/event.entity';
import { NodeEntity } from '../nodes/entities/node.entity';
import { TaskEntity } from '../tasks/entities/task.entity';
import { UsersModule } from '../users/users.module';
import { ScheduledTaskEntity } from '../tasks/entities/scheduled-task.entity';
import { UserEntity } from '../users/entities/user.entity';
import { WorkspaceDataBootstrap } from './bootstrap/workspace-data.bootstrap';
import { WorkspaceSchemaBootstrap } from './bootstrap/workspace-schema.bootstrap';
import { TeamMembershipEntity } from './entities/team-membership.entity';
import { TeamEntity } from './entities/team.entity';
import { WorkspaceMembershipEntity } from './entities/workspace-membership.entity';
import { WorkspaceEntity } from './entities/workspace.entity';
import { WorkspacesController } from './workspaces.controller';
import { WorkspacesService } from './workspaces.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      WorkspaceEntity,
      WorkspaceMembershipEntity,
      TeamEntity,
      TeamMembershipEntity,
      UserEntity,
      NodeEntity,
      TaskEntity,
      EventEntity,
      ScheduledTaskEntity,
    ]),
    forwardRef(() => AuditLogsModule),
    forwardRef(() => UsersModule),
  ],
  controllers: [WorkspacesController],
  providers: [
    WorkspacesService,
    WorkspaceSchemaBootstrap,
    WorkspaceDataBootstrap,
    WorkspaceMembershipGuard,
    WorkspaceRolesGuard,
  ],
  exports: [WorkspacesService, WorkspaceMembershipGuard, WorkspaceRolesGuard],
})
export class WorkspacesModule {}
