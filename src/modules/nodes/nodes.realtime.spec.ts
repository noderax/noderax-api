import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { PUBSUB_CHANNELS } from '../../common/constants/pubsub.constants';
import { RedisService } from '../../redis/redis.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { EventsService } from '../events/events.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { NodesService } from './nodes.service';
import { NodeEntity } from './entities/node.entity';
import { NodeRootAccessProfile } from './entities/node-root-access-profile.enum';
import { NodeRootAccessSyncStatus } from './entities/node-root-access-sync-status.enum';
import { NodeStatus } from './entities/node-status.enum';

describe('NodesService realtime publishing', () => {
  const createService = () => {
    const realtimeGateway = {
      emitNodeStatusUpdate: jest.fn(),
      emitNodeRootAccessUpdate: jest.fn(),
    } as unknown as jest.Mocked<RealtimeGateway>;
    const redisService = {
      getInstanceId: jest.fn().mockReturnValue('instance-1'),
      publish: jest.fn().mockResolvedValue(1),
    } as unknown as jest.Mocked<RedisService>;
    const outboxService = {
      enqueue: jest.fn(),
    };

    const service = new NodesService(
      {} as Repository<NodeEntity>,
      {} as ConfigService,
      {} as EventsService,
      realtimeGateway,
      redisService,
      {} as WorkspacesService,
      {} as AuditLogsService,
      outboxService as never,
    );

    return {
      service,
      realtimeGateway,
      redisService,
      outboxService,
    };
  };

  it('publishes node status updates immediately even when outbox is available', async () => {
    const { service, realtimeGateway, redisService, outboxService } =
      createService();

    await service.broadcastStatusUpdate({
      id: 'node-1',
      workspaceId: 'workspace-1',
      hostname: 'srv-01',
      status: NodeStatus.ONLINE,
      lastSeenAt: new Date('2026-04-13T13:10:00.000Z'),
      agentVersion: '1.0.0',
      lastVersionReportedAt: new Date('2026-04-13T13:10:00.000Z'),
    });

    expect(realtimeGateway.emitNodeStatusUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeId: 'node-1',
        workspaceId: 'workspace-1',
        sourceInstanceId: 'instance-1',
      }),
    );
    expect(redisService.publish).toHaveBeenCalledWith(
      PUBSUB_CHANNELS.NODES_STATUS_UPDATED,
      expect.objectContaining({
        nodeId: 'node-1',
        workspaceId: 'workspace-1',
        sourceInstanceId: 'instance-1',
      }),
    );
    expect(outboxService.enqueue).not.toHaveBeenCalled();
  });

  it('publishes root access updates immediately even when outbox is available', async () => {
    const { service, realtimeGateway, redisService, outboxService } =
      createService();

    await service.broadcastRootAccessUpdate({
      id: 'node-1',
      workspaceId: 'workspace-1',
      rootAccessProfile: NodeRootAccessProfile.OPERATIONAL,
      rootAccessAppliedProfile: NodeRootAccessProfile.OPERATIONAL,
      rootAccessSyncStatus: NodeRootAccessSyncStatus.APPLIED,
      rootAccessUpdatedAt: new Date('2026-04-13T13:15:00.000Z'),
      rootAccessUpdatedByUserId: 'user-1',
      rootAccessLastAppliedAt: new Date('2026-04-13T13:15:00.000Z'),
      rootAccessLastError: null,
    });

    expect(realtimeGateway.emitNodeRootAccessUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeId: 'node-1',
        workspaceId: 'workspace-1',
        sourceInstanceId: 'instance-1',
      }),
    );
    expect(redisService.publish).toHaveBeenCalledWith(
      PUBSUB_CHANNELS.NODES_ROOT_ACCESS_UPDATED,
      expect.objectContaining({
        nodeId: 'node-1',
        workspaceId: 'workspace-1',
        sourceInstanceId: 'instance-1',
      }),
    );
    expect(outboxService.enqueue).not.toHaveBeenCalled();
  });
});
