import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NodesModule } from '../nodes/nodes.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { EnrollmentSchemaBootstrap } from './bootstrap/enrollment-schema.bootstrap';
import { EnrollmentEntity } from './entities/enrollment.entity';
import { EnrollmentsController } from './enrollments.controller';
import { EnrollmentTokensService } from './enrollment-tokens.service';
import { EnrollmentsService } from './enrollments.service';
import { WorkspaceEnrollmentsController } from './workspace-enrollments.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([EnrollmentEntity]),
    UsersModule,
    NodesModule,
    NotificationsModule,
    WorkspacesModule,
  ],
  controllers: [EnrollmentsController, WorkspaceEnrollmentsController],
  providers: [
    EnrollmentsService,
    EnrollmentTokensService,
    EnrollmentSchemaBootstrap,
  ],
  exports: [EnrollmentsService, EnrollmentTokensService],
})
export class EnrollmentsModule {}
