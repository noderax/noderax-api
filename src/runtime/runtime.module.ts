import { Global, Module } from '@nestjs/common';
import { ClusterLockService } from './cluster-lock.service';
import { PrometheusMetricsService } from './prometheus-metrics.service';
import { RuntimePromotionService } from './runtime-promotion.service';

@Global()
@Module({
  providers: [
    ClusterLockService,
    PrometheusMetricsService,
    RuntimePromotionService,
  ],
  exports: [ClusterLockService, PrometheusMetricsService],
})
export class RuntimeModule {}
