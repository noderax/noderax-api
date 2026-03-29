import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from '../users/entities/user.entity';
import { WorkspaceMembershipEntity } from '../workspaces/entities/workspace-membership.entity';
import { WorkspaceEntity } from '../workspaces/entities/workspace.entity';
import { NodeEntity } from '../nodes/entities/node.entity';
import { MailerService } from './mailer.service';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserEntity,
      WorkspaceMembershipEntity,
      WorkspaceEntity,
      NodeEntity,
    ]),
  ],
  providers: [NotificationsService, MailerService],
  exports: [NotificationsService, MailerService],
})
export class NotificationsModule {}
