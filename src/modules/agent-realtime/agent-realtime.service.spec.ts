/// <reference types="jest" />

import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { AGENT_REALTIME_SERVER_EVENTS } from '../../common/constants/agent-realtime.constants';
import { RedisService } from '../../redis/redis.service';
import { MetricsService } from '../metrics/metrics.service';
import { NodeStatus } from '../nodes/entities/node-status.enum';
import { NodesService } from '../nodes/nodes.service';
import { TaskStatus } from '../tasks/entities/task-status.enum';
import { TasksService } from '../tasks/tasks.service';
import { AgentTaskLifecycleEventEntity } from './entities/agent-task-lifecycle-event.entity';
import { AgentRealtimeService } from './agent-realtime.service';

describe('AgentRealtimeService', () => {
  let service: AgentRealtimeService;
  let lifecycleRepository: jest.Mocked<
    Repository<AgentTaskLifecycleEventEntity>
  >;
  let nodesService: jest.Mocked<NodesService>;
  let redisService: jest.Mocked<RedisService>;

  beforeEach(() => {
    lifecycleRepository = {
      create: jest.fn((value) => value),
      save: jest.fn(),
    } as unknown as jest.Mocked<Repository<AgentTaskLifecycleEventEntity>>;

    nodesService = {
      authenticateAgent: jest.fn().mockResolvedValue({
        id: 'node-1',
        hostname: 'node-1.local',
        status: NodeStatus.ONLINE,
      }),
      markOnline: jest.fn().mockResolvedValue({
        node: {
          id: 'node-1',
          hostname: 'node-1.local',
          status: NodeStatus.ONLINE,
          lastSeenAt: new Date('2026-03-20T10:00:00.000Z'),
        },
      }),
      broadcastStatusUpdate: jest.fn(),
      markOffline: jest.fn().mockResolvedValue({
        node: {
          id: 'node-1',
          hostname: 'node-1.local',
          status: NodeStatus.OFFLINE,
          lastSeenAt: new Date('2026-03-20T10:00:00.000Z'),
        },
      }),
    } as unknown as jest.Mocked<NodesService>;

    redisService = {
      isEnabled: jest.fn().mockReturnValue(false),
      subscribe: jest.fn(),
      set: jest.fn(),
      get: jest.fn().mockResolvedValue(null),
      del: jest.fn(),
      publish: jest.fn(),
    } as unknown as jest.Mocked<RedisService>;

    const configService = {
      getOrThrow: jest.fn().mockReturnValue({
        realtimePingTimeoutSeconds: 45,
        realtimePingCheckIntervalSeconds: 5,
      }),
    } as unknown as ConfigService;

    const tasksService = {
      findQueuedForNode: jest.fn().mockResolvedValue([]),
    } as unknown as TasksService;

    const metricsService = {
      ingest: jest.fn(),
    } as unknown as MetricsService;

    service = new AgentRealtimeService(
      lifecycleRepository,
      nodesService,
      redisService,
      configService,
      tasksService,
      metricsService,
    );
  });

  it('deduplicates lifecycle events using unique key conflicts', async () => {
    lifecycleRepository.save
      .mockResolvedValueOnce({} as AgentTaskLifecycleEventEntity)
      .mockRejectedValueOnce({ code: '23505' });

    const first = await service.registerLifecycleEvent({
      nodeId: 'node-1',
      taskId: 'task-1',
      eventType: 'task.started',
      eventTimestamp: '2026-03-20T12:00:00.000Z',
      payload: { type: 'task.started' },
    });

    const second = await service.registerLifecycleEvent({
      nodeId: 'node-1',
      taskId: 'task-1',
      eventType: 'task.started',
      eventTimestamp: '2026-03-20T12:00:00.000Z',
      payload: { type: 'task.started' },
    });

    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it('dispatches protocol-compliant task envelope to local socket', async () => {
    const emit = jest.fn().mockReturnValue(true);
    service.bindSocketEmitter(emit);

    await service.authenticateSocket({
      socketId: 'socket-1',
      nodeId: 'node-1',
      agentToken: 'token-1',
    });

    const dispatched = await service.dispatchTaskToNode({
      id: 'task-1',
      nodeId: 'node-1',
      type: 'shell.exec',
      payload: {
        command: 'echo hello',
        timeoutSeconds: 90,
      },
      status: TaskStatus.QUEUED,
      createdAt: new Date('2026-03-20T12:00:00.000Z'),
      updatedAt: new Date('2026-03-20T12:00:00.000Z'),
    } as never);

    expect(dispatched).toBe(true);
    expect(emit).toHaveBeenCalledWith(
      'socket-1',
      AGENT_REALTIME_SERVER_EVENTS.TASK_DISPATCH,
      {
        type: 'task.dispatch',
        task: {
          id: 'task-1',
          type: 'shell.exec',
          payload: {
            command: 'echo hello',
            timeoutSeconds: 90,
          },
          timeoutSeconds: 90,
        },
      },
    );
  });
});
