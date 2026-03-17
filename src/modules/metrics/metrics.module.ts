import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventsModule } from '../events/events.module';
import { NodesModule } from '../nodes/nodes.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { MetricEntity } from './entities/metric.entity';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([MetricEntity]),
    NodesModule,
    EventsModule,
    RealtimeModule,
  ],
  controllers: [MetricsController],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsModule {}
