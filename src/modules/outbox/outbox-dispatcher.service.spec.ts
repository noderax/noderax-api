import { PUBSUB_CHANNELS } from '../../common/constants/pubsub.constants';
import { OutboxDispatcherService } from './outbox-dispatcher.service';

describe('OutboxDispatcherService realtime payload forwarding', () => {
  let outboxService: {
    getWorkerId: jest.Mock;
    claimDueBatch: jest.Mock;
    markDelivered: jest.Mock;
    markFailed: jest.Mock;
  };
  let realtimeGateway: {
    emitEventCreated: jest.Mock;
    emitMetricIngested: jest.Mock;
    emitNodeInstallUpdated: jest.Mock;
    emitNodeRootAccessUpdate: jest.Mock;
    emitNodeStatusUpdate: jest.Mock;
    emitTaskCreated: jest.Mock;
    emitTaskUpdated: jest.Mock;
  };
  let redisService: {
    publish: jest.Mock;
  };
  let notificationsService: {
    notifyEvent: jest.Mock;
  };
  let service: OutboxDispatcherService;

  beforeEach(() => {
    outboxService = {
      getWorkerId: jest.fn().mockReturnValue('worker-1'),
      claimDueBatch: jest.fn(),
      markDelivered: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
    };
    realtimeGateway = {
      emitEventCreated: jest.fn(),
      emitMetricIngested: jest.fn(),
      emitNodeInstallUpdated: jest.fn(),
      emitNodeRootAccessUpdate: jest.fn(),
      emitNodeStatusUpdate: jest.fn(),
      emitTaskCreated: jest.fn(),
      emitTaskUpdated: jest.fn(),
    };
    redisService = {
      publish: jest.fn().mockResolvedValue(1),
    };
    notificationsService = {
      notifyEvent: jest.fn().mockResolvedValue(undefined),
    };

    service = new OutboxDispatcherService(
      outboxService as never,
      realtimeGateway as never,
      redisService as never,
      notificationsService as never,
    );
  });

  it('publishes full event payloads to Redis for event.created', async () => {
    const eventPayload = {
      id: 'event-1',
      workspaceId: 'workspace-1',
      nodeId: 'node-1',
      type: 'high.cpu',
      severity: 'warning',
      message: 'CPU rose',
      createdAt: '2026-04-18T17:00:00.000Z',
      sourceInstanceId: 'instance-a',
    };

    outboxService.claimDueBatch.mockResolvedValueOnce([
      {
        id: 'outbox-1',
        type: 'event.created',
        payload: { event: eventPayload },
      },
    ]);
    outboxService.claimDueBatch.mockResolvedValueOnce([]);

    await service.dispatchDueEvents();

    expect(realtimeGateway.emitEventCreated).toHaveBeenCalledWith(eventPayload);
    expect(redisService.publish).toHaveBeenCalledWith(
      PUBSUB_CHANNELS.EVENTS_CREATED,
      eventPayload,
    );
    expect(notificationsService.notifyEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'event-1',
        workspaceId: 'workspace-1',
      }),
      { propagateErrors: true },
    );
  });

  it('publishes full task payloads to Redis for task.updated', async () => {
    const taskPayload = {
      id: 'task-1',
      workspaceId: 'workspace-1',
      nodeId: 'node-1',
      status: 'running',
      updatedAt: '2026-04-18T17:00:00.000Z',
      createdAt: '2026-04-18T16:59:00.000Z',
      sourceInstanceId: 'instance-a',
    };

    outboxService.claimDueBatch.mockResolvedValueOnce([
      {
        id: 'outbox-2',
        type: 'task.updated',
        payload: { task: taskPayload },
      },
    ]);
    outboxService.claimDueBatch.mockResolvedValueOnce([]);

    await service.dispatchDueEvents();

    expect(realtimeGateway.emitTaskUpdated).toHaveBeenCalledWith(taskPayload);
    expect(redisService.publish).toHaveBeenCalledWith(
      PUBSUB_CHANNELS.TASKS_UPDATED,
      taskPayload,
    );
  });

  it('marks unknown outbox event types as failed instead of delivering them', async () => {
    outboxService.claimDueBatch.mockResolvedValueOnce([
      {
        id: 'outbox-3',
        type: 'totally.unknown',
        attempts: 1,
        maxAttempts: 8,
        payload: {},
      },
    ]);
    outboxService.claimDueBatch.mockResolvedValueOnce([]);

    await service.dispatchDueEvents();

    expect(outboxService.markDelivered).not.toHaveBeenCalled();
    expect(outboxService.markFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'outbox-3',
        type: 'totally.unknown',
      }),
      expect.stringContaining('Unknown outbox event type'),
    );
  });

  it('does not attempt markFailed when a malformed outbox event has no id', async () => {
    outboxService.claimDueBatch.mockResolvedValueOnce([
      {
        id: '',
        type: '',
        payload: null,
      },
    ]);
    outboxService.claimDueBatch.mockResolvedValueOnce([]);

    await service.dispatchDueEvents();

    expect(outboxService.markDelivered).not.toHaveBeenCalled();
    expect(outboxService.markFailed).not.toHaveBeenCalled();
  });
});
