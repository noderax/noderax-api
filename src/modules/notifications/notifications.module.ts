import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from '../users/entities/user.entity';
import { WorkspaceMembershipEntity } from '../workspaces/entities/workspace-membership.entity';
import { MailerService } from './mailer.service';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [TypeOrmModule.forFeature([UserEntity, WorkspaceMembershipEntity])],
  providers: [NotificationsService, MailerService],
  exports: [NotificationsService, MailerService],
})
export class NotificationsModule {}
