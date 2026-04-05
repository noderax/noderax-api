import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { NodesModule } from '../nodes/nodes.module';
import { TaskEntity } from '../tasks/entities/task.entity';
import { TasksModule } from '../tasks/tasks.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { IncidentsSchemaBootstrap } from './bootstrap/incidents-schema.bootstrap';
import { IncidentAnalysisEntity } from './entities/incident-analysis.entity';
import { IncidentEntity } from './entities/incident.entity';
import { LogMonitorCursorEntity } from './entities/log-monitor-cursor.entity';
import { LogMonitorRuleEntity } from './entities/log-monitor-rule.entity';
import { IncidentsService } from './incidents.service';
import { LogMonitorRunnerService } from './log-monitor-runner.service';
import { WorkspaceIncidentsController } from './workspace-incidents.controller';
import { WorkspaceNodeLogMonitorsController } from './workspace-node-log-monitors.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      LogMonitorRuleEntity,
      LogMonitorCursorEntity,
      IncidentEntity,
      IncidentAnalysisEntity,
      TaskEntity,
    ]),
    AuditLogsModule,
    forwardRef(() => NodesModule),
    forwardRef(() => TasksModule),
    WorkspacesModule,
  ],
  controllers: [
    WorkspaceNodeLogMonitorsController,
    WorkspaceIncidentsController,
  ],
  providers: [
    IncidentsService,
    IncidentsSchemaBootstrap,
    LogMonitorRunnerService,
  ],
  exports: [IncidentsService],
})
export class IncidentsModule {}
