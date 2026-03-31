import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RedisModule } from '../../redis/redis.module';
import { NodesModule } from '../nodes/nodes.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { UsersModule } from '../users/users.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { EnrollmentSchemaBootstrap } from './bootstrap/enrollment-schema.bootstrap';
import { EnrollmentEntity } from './entities/enrollment.entity';
import { EnrollmentsController } from './enrollments.controller';
import { EnrollmentTokensService } from './enrollment-tokens.service';
import { EnrollmentsService } from './enrollments.service';
import { NodeInstallEntity } from './entities/node-install.entity';
import { NodeInstallsController } from './node-installs.controller';
import { WorkspaceEnrollmentsController } from './workspace-enrollments.controller';
import { WorkspaceNodeInstallsController } from './workspace-node-installs.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([EnrollmentEntity, NodeInstallEntity]),
    UsersModule,
    NodesModule,
    NotificationsModule,
    RealtimeModule,
    RedisModule,
    WorkspacesModule,
  ],
  controllers: [
    EnrollmentsController,
    WorkspaceEnrollmentsController,
    NodeInstallsController,
    WorkspaceNodeInstallsController,
  ],
  providers: [
    EnrollmentsService,
    EnrollmentTokensService,
    EnrollmentSchemaBootstrap,
  ],
  exports: [EnrollmentsService, EnrollmentTokensService],
})
export class EnrollmentsModule {}
