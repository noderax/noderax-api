import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentAuthGuard } from '../../common/guards/agent-auth.guard';
import { legacyOnlyProviders } from '../../install/legacy-bootstrap.utils';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { EventsModule } from '../events/events.module';
import { NodeEntity } from '../nodes/entities/node.entity';
import { NodesModule } from '../nodes/nodes.module';
import { TasksModule } from '../tasks/tasks.module';
import { AgentReleaseCatalogService } from './agent-release-catalog.service';
import { AgentUpdateProgressController } from './agent-update-progress.controller';
import { AgentUpdateRolloutMonitorService } from './agent-update-rollout-monitor.service';
import { AgentUpdatesController } from './agent-updates.controller';
import { AgentUpdatesService } from './agent-updates.service';
import { AgentUpdateSchemaBootstrap } from './bootstrap/agent-update-schema.bootstrap';
import { AgentUpdateRolloutEntity } from './entities/agent-update-rollout.entity';
import { AgentUpdateRolloutTargetEntity } from './entities/agent-update-rollout-target.entity';
import { TaskEntity } from '../tasks/entities/task.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AgentUpdateRolloutEntity,
      AgentUpdateRolloutTargetEntity,
      NodeEntity,
      TaskEntity,
    ]),
    NodesModule,
    forwardRef(() => TasksModule),
    EventsModule,
    AuditLogsModule,
  ],
  controllers: [AgentUpdatesController, AgentUpdateProgressController],
  providers: [
    AgentUpdatesService,
    AgentReleaseCatalogService,
    AgentUpdateRolloutMonitorService,
    AgentAuthGuard,
    ...legacyOnlyProviders([AgentUpdateSchemaBootstrap]),
  ],
  exports: [AgentUpdatesService],
})
export class AgentUpdatesModule {}
