import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { EventsModule } from '../events/events.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { NodeOfflineDetectorService } from './node-offline-detector.service';
import { NodeEntity } from './entities/node.entity';
import { NodesController } from './nodes.controller';
import { NodesService } from './nodes.service';
import { WorkspaceNodesController } from './workspace-nodes.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([NodeEntity]),
    AuditLogsModule,
    EventsModule,
    RealtimeModule,
    WorkspacesModule,
  ],
  controllers: [NodesController, WorkspaceNodesController],
  providers: [NodesService, NodeOfflineDetectorService],
  exports: [NodesService],
})
export class NodesModule {}
