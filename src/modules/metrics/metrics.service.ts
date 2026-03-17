import { Injectable } from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { agentsConfig } from '../../config';
import { PUBSUB_CHANNELS } from '../../common/constants/pubsub.constants';
import { SYSTEM_EVENT_TYPES } from '../../common/constants/system-event.constants';
import { RedisService } from '../../redis/redis.service';
import { EventSeverity } from '../events/entities/event-severity.enum';
import { EventsService } from '../events/events.service';
import { NodesService } from '../nodes/nodes.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { AgentMetricsDto } from './dto/agent-metrics.dto';
import { QueryMetricsDto } from './dto/query-metrics.dto';
import { MetricEntity } from './entities/metric.entity';

@Injectable()
export class MetricsService {
  constructor(
    @InjectRepository(MetricEntity)
    private readonly metricsRepository: Repository<MetricEntity>,
    private readonly nodesService: NodesService,
    private readonly eventsService: EventsService,
    private readonly realtimeGateway: RealtimeGateway,
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
  ) {}

  async ingest(agentMetricsDto: AgentMetricsDto) {
    const node = await this.nodesService.authenticateAgent(
      agentMetricsDto.nodeId,
      agentMetricsDto.agentToken,
    );

    await this.nodesService.touchOnline(node.id);

    const metric = this.metricsRepository.create({
      nodeId: agentMetricsDto.nodeId,
      cpuUsage: agentMetricsDto.cpuUsage,
      memoryUsage: agentMetricsDto.memoryUsage,
      diskUsage: agentMetricsDto.diskUsage,
      networkStats: agentMetricsDto.networkStats,
    });

    const savedMetric = await this.metricsRepository.save(metric);

    const agents = this.configService.getOrThrow<
      ConfigType<typeof agentsConfig>
    >(agentsConfig.KEY);
    if (savedMetric.cpuUsage >= agents.highCpuThreshold) {
      await this.eventsService.record({
        nodeId: savedMetric.nodeId,
        type: SYSTEM_EVENT_TYPES.HIGH_CPU,
        severity:
          savedMetric.cpuUsage >= Math.min(100, agents.highCpuThreshold + 5)
            ? EventSeverity.CRITICAL
            : EventSeverity.WARNING,
        message: `CPU usage on ${node.hostname} reached ${savedMetric.cpuUsage.toFixed(1)}%`,
        metadata: {
          cpuUsage: savedMetric.cpuUsage,
        },
      });
    }

    this.realtimeGateway.emitMetricIngested(
      savedMetric as unknown as Record<string, unknown>,
    );
    await this.redisService.publish(PUBSUB_CHANNELS.METRICS_INGESTED, {
      metricId: savedMetric.id,
      nodeId: savedMetric.nodeId,
      recordedAt: savedMetric.recordedAt.toISOString(),
    });

    return savedMetric;
  }

  async findAll(query: QueryMetricsDto) {
    const metricsQuery = this.metricsRepository
      .createQueryBuilder('metric')
      .orderBy('metric.recordedAt', 'DESC')
      .take(query.limit ?? 50);

    if (query.nodeId) {
      metricsQuery.andWhere('metric.nodeId = :nodeId', {
        nodeId: query.nodeId,
      });
    }

    return metricsQuery.getMany();
  }
}
