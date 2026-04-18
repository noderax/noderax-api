/// <reference types="jest" />

import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { AGENT_REALTIME_SERVER_EVENTS } from '../../common/constants/agent-realtime.constants';
import { SYSTEM_EVENT_TYPES } from '../../common/constants/system-event.constants';
import { RedisService } from '../../redis/redis.service';
import { AgentUpdatesService } from '../agent-updates/agent-updates.service';
import { EventsService } from '../events/events.service';
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
  let metricsService: jest.Mocked<MetricsService>;
  let agentUpdatesService: jest.Mocked<AgentUpdatesService>;
  let eventsService: jest.Mocked<EventsService>;

  beforeEach(async () => {
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
      recordAgentRootAccessState: jest.fn().mockResolvedValue(null),
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

    metricsService = {
      ingest: jest.fn(),
    } as unknown as jest.Mocked<MetricsService>;

    agentUpdatesService = {
      observeNodeVersion: jest.fn(),
    } as unknown as jest.Mocked<AgentUpdatesService>;

    eventsService = {
      record: jest.fn(),
    } as unknown as jest.Mocked<EventsService>;

    const configService = {
      getOrThrow: jest.fn().mockReturnValue({
        enableRealtimeTaskDispatch: true,
        realtimePingTimeoutSeconds: 45,
        realtimePingCheckIntervalSeconds: 5,
      }),
    } as unknown as ConfigService;

    const tasksService = {
      findQueuedForNode: jest.fn().mockResolvedValue([]),
    } as unknown as TasksService;

    service = new AgentRealtimeService(
      lifecycleRepository,
      nodesService,
      redisService,
      configService,
      tasksService,
      metricsService,
      agentUpdatesService,
      eventsService,
    );

    await service.onModuleInit();
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

  it('observes rollout completion when realtime auth reports the target version', async () => {
    nodesService.markOnline.mockResolvedValueOnce({
      node: {
        id: 'node-1',
        hostname: 'node-1.local',
        status: NodeStatus.ONLINE,
        agentVersion: '1.0.0',
        lastSeenAt: new Date('2026-03-20T10:00:00.000Z'),
      } as never,
      transitionedToOnline: false,
    });

    await service.authenticateSocket({
      socketId: 'socket-1',
      nodeId: 'node-1',
      agentToken: 'token-1',
      agentVersion: '1.0.0',
    });

    expect(nodesService.markOnline).toHaveBeenCalledWith('node-1', {
      agentVersion: '1.0.0',
      platformVersion: null,
      kernelVersion: null,
    });
    expect(agentUpdatesService.observeNodeVersion).toHaveBeenCalledWith({
      id: 'node-1',
      agentVersion: '1.0.0',
    });
  });

  it('observes rollout completion when realtime metrics carry a newer version', async () => {
    await service.authenticateSocket({
      socketId: 'socket-1',
      nodeId: 'node-1',
      agentToken: 'token-1',
    });

    nodesService.markOnline.mockResolvedValueOnce({
      node: {
        id: 'node-1',
        hostname: 'node-1.local',
        status: NodeStatus.ONLINE,
        agentVersion: '1.0.1',
        lastSeenAt: new Date('2026-03-20T10:00:00.000Z'),
      } as never,
      transitionedToOnline: false,
    });

    await service.ingestRealtimeMetrics('socket-1', {
      agentVersion: '1.0.1',
      cpuUsage: 10,
      memoryUsage: 20,
      diskUsage: 30,
      networkStats: {},
    });

    expect(metricsService.ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeId: 'node-1',
        agentToken: 'token-1',
        agentVersion: '1.0.1',
      }),
    );
    expect(nodesService.markOnline).toHaveBeenLastCalledWith('node-1', {
      agentVersion: '1.0.1',
    });
    expect(agentUpdatesService.observeNodeVersion).toHaveBeenLastCalledWith({
      id: 'node-1',
      agentVersion: '1.0.1',
    });
  });

  it('dispatches protocol-compliant root access update payload to local socket', async () => {
    const emit = jest.fn().mockReturnValue(true);
    service.bindSocketEmitter(emit);

    await service.authenticateSocket({
      socketId: 'socket-1',
      nodeId: 'node-1',
      agentToken: 'token-1',
    });

    const dispatched = await service.dispatchRootAccessUpdate('node-1', {
      profile: 'operational' as never,
      updatedAt: '2026-04-04T17:25:00.000Z',
    });

    expect(dispatched).toBe(true);
    expect(emit).toHaveBeenCalledWith(
      'socket-1',
      AGENT_REALTIME_SERVER_EVENTS.ROOT_ACCESS_UPDATED,
      {
        type: AGENT_REALTIME_SERVER_EVENTS.ROOT_ACCESS_UPDATED,
        rootAccess: {
          profile: 'operational',
          updatedAt: '2026-04-04T17:25:00.000Z',
        },
      },
    );
  });

  it('records a node offline event when the active realtime socket disconnects', async () => {
    await service.authenticateSocket({
      socketId: 'socket-1',
      nodeId: 'node-1',
      agentToken: 'token-1',
    });

    nodesService.markOffline.mockResolvedValueOnce({
      node: {
        id: 'node-1',
        hostname: 'node-1.local',
        status: NodeStatus.OFFLINE,
        lastSeenAt: new Date('2026-03-20T10:00:00.000Z'),
      } as never,
      transitionedToOffline: true,
    });

    await service.handleSocketDisconnect('socket-1');

    expect(eventsService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeId: 'node-1',
        type: SYSTEM_EVENT_TYPES.NODE_OFFLINE,
      }),
    );
    expect(nodesService.broadcastStatusUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'node-1',
        status: NodeStatus.OFFLINE,
      }),
    );
  });
});
