import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Repository } from 'typeorm';
import { AGENTS_CONFIG_KEY, agentsConfig } from '../../config';
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

    await this.nodesService.markOnline(node.id);

    const metric = this.metricsRepository.create({
      nodeId: agentMetricsDto.nodeId,
      cpuUsage: this.resolvePercentageMetric(
        agentMetricsDto.cpuUsage,
        agentMetricsDto.cpu,
        'usagePercent',
        'cpuUsage',
      ),
      memoryUsage: this.resolvePercentageMetric(
        agentMetricsDto.memoryUsage,
        agentMetricsDto.memory,
        'usedPercent',
        'memoryUsage',
      ),
      diskUsage: this.resolvePercentageMetric(
        agentMetricsDto.diskUsage,
        agentMetricsDto.disk,
        'usedPercent',
        'diskUsage',
      ),
      temperature: agentMetricsDto.temperature ?? null,
      networkStats: this.resolveNetworkStats(agentMetricsDto),
    });

    const savedMetric = await this.metricsRepository.save(metric);

    const agents =
      this.configService.getOrThrow<ConfigType<typeof agentsConfig>>(
        AGENTS_CONFIG_KEY,
      );
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
      ...(savedMetric as unknown as Record<string, unknown>),
      sourceInstanceId: this.redisService.getInstanceId(),
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

  private resolvePercentageMetric(
    directValue: number | undefined,
    nestedValue: Record<string, unknown> | undefined,
    nestedKey: string,
    fieldName: string,
  ): number {
    if (typeof directValue === 'number') {
      return directValue;
    }

    const candidate = nestedValue?.[nestedKey];
    if (typeof candidate === 'number') {
      return candidate;
    }

    throw new BadRequestException(`${fieldName} is required`);
  }

  private resolveNetworkStats(
    agentMetricsDto: AgentMetricsDto,
  ): Record<string, unknown> {
    if (agentMetricsDto.networkStats) {
      return agentMetricsDto.networkStats;
    }

    if (!Array.isArray(agentMetricsDto.networks)) {
      return this.buildDefaultNetworkSummary([]);
    }

    const summary = this.buildDefaultNetworkSummary(agentMetricsDto.networks);

    for (const network of agentMetricsDto.networks) {
      summary.rxBytes += this.readNetworkCounter(network, 'bytesRecv');
      summary.txBytes += this.readNetworkCounter(network, 'bytesSent');
      summary.rxPackets += this.readNetworkCounter(network, 'packetsRecv');
      summary.txPackets += this.readNetworkCounter(network, 'packetsSent');
      summary.errorsIn += this.readNetworkCounter(network, 'errorsIn');
      summary.errorsOut += this.readNetworkCounter(network, 'errorsOut');
      summary.dropIn += this.readNetworkCounter(network, 'dropIn');
      summary.dropOut += this.readNetworkCounter(network, 'dropOut');
    }

    return summary;
  }

  private buildDefaultNetworkSummary(
    interfaces: Array<Record<string, unknown>>,
  ): {
    rxBytes: number;
    txBytes: number;
    rxPackets: number;
    txPackets: number;
    errorsIn: number;
    errorsOut: number;
    dropIn: number;
    dropOut: number;
    interfaces: Array<Record<string, unknown>>;
  } {
    return {
      rxBytes: 0,
      txBytes: 0,
      rxPackets: 0,
      txPackets: 0,
      errorsIn: 0,
      errorsOut: 0,
      dropIn: 0,
      dropOut: 0,
      interfaces,
    };
  }

  private readNetworkCounter(
    network: Record<string, unknown>,
    key: string,
  ): number {
    const value = network[key];
    return typeof value === 'number' ? value : 0;
  }
}
