/// <reference types="jest" />

import { PUBSUB_CHANNELS } from '../../../common/constants/pubsub.constants';
import { RedisService } from '../../../redis/redis.service';
import { RealtimeGateway } from '../realtime.gateway';
import { RealtimePubsubBridgeService } from './realtime-pubsub-bridge.service';

describe('RealtimePubsubBridgeService', () => {
  let service: RealtimePubsubBridgeService;
  let redisService: jest.Mocked<RedisService>;
  let realtimeGateway: jest.Mocked<RealtimeGateway>;
  let subscriptions: Map<string, (payload: unknown) => void>;

  beforeEach(() => {
    subscriptions = new Map();

    redisService = {
      isEnabled: jest.fn().mockReturnValue(true),
      subscribe: jest.fn().mockImplementation(async (channel, handler) => {
        subscriptions.set(channel, handler as (payload: unknown) => void);
        return async () => {
          subscriptions.delete(channel);
        };
      }),
      getInstanceId: jest.fn().mockReturnValue('instance-a'),
    } as unknown as jest.Mocked<RedisService>;

    realtimeGateway = {
      emitEventCreated: jest.fn(),
      emitMetricIngested: jest.fn(),
      emitNodeInstallUpdated: jest.fn(),
      emitNodeRootAccessUpdate: jest.fn(),
      emitNodeStatusUpdate: jest.fn(),
      emitTaskCreated: jest.fn(),
      emitTaskUpdated: jest.fn(),
    } as unknown as jest.Mocked<RealtimeGateway>;

    service = new RealtimePubsubBridgeService(redisService, realtimeGateway);
  });

  it('subscribes to events.created and forwards foreign events', async () => {
    await service.onModuleInit();

    subscriptions.get(PUBSUB_CHANNELS.EVENTS_CREATED)?.({
      id: 'event-1',
      workspaceId: 'workspace-1',
      sourceInstanceId: 'instance-b',
    });

    expect(realtimeGateway.emitEventCreated).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'event-1',
        workspaceId: 'workspace-1',
      }),
    );
  });

  it('ignores events.created emitted by the same runtime instance', async () => {
    await service.onModuleInit();

    subscriptions.get(PUBSUB_CHANNELS.EVENTS_CREATED)?.({
      id: 'event-2',
      workspaceId: 'workspace-1',
      sourceInstanceId: 'instance-a',
    });

    expect(realtimeGateway.emitEventCreated).not.toHaveBeenCalled();
  });
});
