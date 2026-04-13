import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../redis/redis.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { EventsService } from '../events/events.service';
import { NodesService } from '../nodes/nodes.service';
import { MetricsService } from './metrics.service';
import { MetricEntity } from './entities/metric.entity';

type MockRepository<T> = Partial<
  Record<keyof Repository<T>, jest.Mock | Repository<T>[keyof Repository<T>]>
> & {
  create: jest.Mock;
  save: jest.Mock;
};

describe('MetricsService', () => {
  it('emits realtime metrics immediately even when outbox is available', async () => {
    const metricsRepository: MockRepository<MetricEntity> = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({
        id: 'metric-1',
        recordedAt: new Date('2026-04-13T13:00:00.000Z'),
        ...value,
      })),
    };
    const nodesService = {
      authenticateAgent: jest.fn().mockResolvedValue({
        id: 'node-1',
        workspaceId: 'workspace-1',
        hostname: 'srv-01',
      }),
      markOnline: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<NodesService>;
    const eventsService = {
      record: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<EventsService>;
    const realtimeGateway = {
      emitMetricIngested: jest.fn(),
    } as unknown as jest.Mocked<RealtimeGateway>;
    const redisService = {
      getInstanceId: jest.fn().mockReturnValue('instance-1'),
      publish: jest.fn().mockResolvedValue(1),
    } as unknown as jest.Mocked<RedisService>;
    const configService = {
      getOrThrow: jest.fn().mockReturnValue({
        highCpuThreshold: 90,
      }),
    } as unknown as ConfigService;
    const outboxService = {
      enqueue: jest.fn(),
    };

    const service = new MetricsService(
      metricsRepository as unknown as Repository<MetricEntity>,
      nodesService,
      eventsService,
      realtimeGateway,
      redisService,
      configService,
      outboxService as never,
    );

    await service.ingest({
      nodeId: 'node-1',
      agentToken: 'agent-token',
      agentVersion: '1.0.0',
      cpuUsage: 12,
      memoryUsage: 18,
      diskUsage: 25,
      temperature: 41,
      networks: [],
    });

    expect(realtimeGateway.emitMetricIngested).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        nodeId: 'node-1',
        agentVersion: '1.0.0',
        sourceInstanceId: 'instance-1',
      }),
    );
    expect(redisService.publish).toHaveBeenCalledWith(
      'metrics.ingested',
      expect.objectContaining({
        workspaceId: 'workspace-1',
        nodeId: 'node-1',
        sourceInstanceId: 'instance-1',
      }),
    );
    expect(outboxService.enqueue).not.toHaveBeenCalled();
  });
});
