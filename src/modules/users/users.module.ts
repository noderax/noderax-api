import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { legacyOnlyProviders } from '../../install/legacy-bootstrap.utils';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ScheduledTaskEntity } from '../tasks/entities/scheduled-task.entity';
import { PasswordResetTokenEntity } from './entities/password-reset-token.entity';
import { TeamMembershipEntity } from '../workspaces/entities/team-membership.entity';
import { UserInvitationEntity } from './entities/user-invitation.entity';
import { WorkspaceMembershipEntity } from '../workspaces/entities/workspace-membership.entity';
import { DefaultAdminBootstrap } from './bootstrap/default-admin.bootstrap';
import { UserPreferencesSchemaBootstrap } from './bootstrap/user-preferences-schema.bootstrap';
import { UserEntity } from './entities/user.entity';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserEntity,
      UserInvitationEntity,
      PasswordResetTokenEntity,
      WorkspaceMembershipEntity,
      TeamMembershipEntity,
      ScheduledTaskEntity,
    ]),
    forwardRef(() => AuditLogsModule),
    NotificationsModule,
  ],
  controllers: [UsersController],
  providers: [
    UsersService,
    ...legacyOnlyProviders([
      DefaultAdminBootstrap,
      UserPreferencesSchemaBootstrap,
    ]),
  ],
  exports: [UsersService],
})
export class UsersModule {}
