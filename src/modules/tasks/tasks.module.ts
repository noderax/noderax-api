import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentAuthGuard } from '../../common/guards/agent-auth.guard';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { AgentRealtimeModule } from '../agent-realtime/agent-realtime.module';
import { EventsModule } from '../events/events.module';
import { NodesModule } from '../nodes/nodes.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { UserEntity } from '../users/entities/user.entity';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { AgentTasksController } from './agent-tasks.controller';
import { ScheduledTaskSchemaBootstrap } from './bootstrap/scheduled-task-schema.bootstrap';
import { TaskSchemaBootstrap } from './bootstrap/task-schema.bootstrap';
import { ScheduledTaskEntity } from './entities/scheduled-task.entity';
import { TaskLogEntity } from './entities/task-log.entity';
import { TaskEntity } from './entities/task.entity';
import { TaskTemplateEntity } from './entities/task-template.entity';
import { ScheduledTaskRunnerService } from './scheduled-task-runner.service';
import { ScheduledTasksController } from './scheduled-tasks.controller';
import { ScheduledTasksService } from './scheduled-tasks.service';
import { TaskStaleDetectorService } from './task-stale-detector.service';
import { TaskTemplateSchemaBootstrap } from './bootstrap/task-template-schema.bootstrap';
import { TaskTemplatesService } from './task-templates.service';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { WorkspaceScheduledTasksController } from './workspace-scheduled-tasks.controller';
import { WorkspaceTaskTemplatesController } from './workspace-task-templates.controller';
import { WorkspaceTasksController } from './workspace-tasks.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TaskEntity,
      TaskLogEntity,
      ScheduledTaskEntity,
      TaskTemplateEntity,
      UserEntity,
    ]),
    AuditLogsModule,
    forwardRef(() => NodesModule),
    EventsModule,
    RealtimeModule,
    WorkspacesModule,
    forwardRef(() => AgentRealtimeModule),
  ],
  controllers: [
    TasksController,
    WorkspaceTasksController,
    AgentTasksController,
    ScheduledTasksController,
    WorkspaceScheduledTasksController,
    WorkspaceTaskTemplatesController,
  ],
  providers: [
    TasksService,
    ScheduledTasksService,
    TaskTemplatesService,
    ScheduledTaskRunnerService,
    TaskSchemaBootstrap,
    ScheduledTaskSchemaBootstrap,
    TaskTemplateSchemaBootstrap,
    TaskStaleDetectorService,
    AgentAuthGuard,
  ],
  exports: [TasksService, ScheduledTasksService, TaskTemplatesService],
})
export class TasksModule {}
