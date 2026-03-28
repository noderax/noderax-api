import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduledTaskEntity } from '../tasks/entities/scheduled-task.entity';
import { TeamMembershipEntity } from '../workspaces/entities/team-membership.entity';
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
      WorkspaceMembershipEntity,
      TeamMembershipEntity,
      ScheduledTaskEntity,
    ]),
  ],
  controllers: [UsersController],
  providers: [
    UsersService,
    DefaultAdminBootstrap,
    UserPreferencesSchemaBootstrap,
  ],
  exports: [UsersService],
})
export class UsersModule {}
