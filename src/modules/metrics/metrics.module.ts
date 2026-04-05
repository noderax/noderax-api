import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventsModule } from '../events/events.module';
import { NodesModule } from '../nodes/nodes.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { MetricEntity } from './entities/metric.entity';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { WorkspaceMetricsController } from './workspace-metrics.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([MetricEntity]),
    forwardRef(() => NodesModule),
    EventsModule,
    RealtimeModule,
    WorkspacesModule,
  ],
  controllers: [MetricsController, WorkspaceMetricsController],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsModule {}
