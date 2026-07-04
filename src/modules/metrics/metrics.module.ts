import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { EventsModule } from '../events/events.module';
import { NodesModule } from '../nodes/nodes.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { MetricEntity } from './entities/metric.entity';
import { MetricsController } from './metrics.controller';
import { MetricsRetentionController } from './metrics-retention.controller';
import { MetricsRetentionService } from './metrics-retention.service';
import { MetricsService } from './metrics.service';
import { WorkspaceMetricsController } from './workspace-metrics.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([MetricEntity]),
    forwardRef(() => NodesModule),
    EventsModule,
    RealtimeModule,
    WorkspacesModule,
    AuditLogsModule,
  ],
  controllers: [
    MetricsController,
    WorkspaceMetricsController,
    MetricsRetentionController,
  ],
  providers: [MetricsService, MetricsRetentionService],
  exports: [MetricsService],
})
export class MetricsModule {}
