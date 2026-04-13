/// <reference types="jest" />

import { Server } from 'socket.io';
import { REALTIME_EVENTS } from '../../common/constants/realtime.constants';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeAuthService } from './services/realtime-auth.service';

describe('RealtimeGateway', () => {
  let gateway: RealtimeGateway;
  let realtimeAuthService: jest.Mocked<RealtimeAuthService>;
  let workspacesService: jest.Mocked<WorkspacesService>;
  let roomEmitter: { emit: jest.Mock };
  let server: { to: jest.Mock };

  beforeEach(() => {
    realtimeAuthService = {
      authenticateSocket: jest.fn(),
    } as unknown as jest.Mocked<RealtimeAuthService>;

    workspacesService = {
      findAccessibleWorkspaces: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<WorkspacesService>;

    roomEmitter = {
      emit: jest.fn(),
    };

    server = {
      to: jest.fn().mockReturnValue(roomEmitter),
    };

    gateway = new RealtimeGateway(realtimeAuthService, workspacesService);
    gateway.server = server as unknown as Server;
  });

  it('emits created events to the workspace room when workspace context exists', () => {
    gateway.emitEventCreated({
      id: 'event-1',
      workspaceId: 'workspace-1',
      nodeId: null,
      type: 'workspace.updated',
    });

    expect(server.to).toHaveBeenCalledWith('workspace:workspace-1');
    expect(roomEmitter.emit).toHaveBeenCalledWith(
      REALTIME_EVENTS.EVENT_CREATED,
      expect.objectContaining({
        id: 'event-1',
        workspaceId: 'workspace-1',
      }),
    );
  });

  it('emits created events to both node and workspace rooms when both contexts exist', () => {
    gateway.emitEventCreated({
      id: 'event-2',
      workspaceId: 'workspace-1',
      nodeId: 'node-1',
      type: 'task.updated',
    });

    expect(server.to).toHaveBeenNthCalledWith(1, 'node:node-1');
    expect(server.to).toHaveBeenNthCalledWith(2, 'workspace:workspace-1');
    expect(roomEmitter.emit).toHaveBeenCalledTimes(2);
  });

  it('emits ingested metrics to both node and workspace rooms when both contexts exist', () => {
    gateway.emitMetricIngested({
      id: 'metric-1',
      workspaceId: 'workspace-1',
      nodeId: 'node-1',
    });

    expect(server.to).toHaveBeenNthCalledWith(1, 'node:node-1');
    expect(server.to).toHaveBeenNthCalledWith(2, 'workspace:workspace-1');
    expect(roomEmitter.emit).toHaveBeenNthCalledWith(
      1,
      REALTIME_EVENTS.METRICS_INGESTED,
      expect.objectContaining({
        id: 'metric-1',
        workspaceId: 'workspace-1',
        nodeId: 'node-1',
      }),
    );
    expect(roomEmitter.emit).toHaveBeenNthCalledWith(
      2,
      REALTIME_EVENTS.METRICS_INGESTED,
      expect.objectContaining({
        id: 'metric-1',
        workspaceId: 'workspace-1',
        nodeId: 'node-1',
      }),
    );
  });

  it('joins accessible workspace rooms on client connect', async () => {
    const join = jest.fn();
    workspacesService.findAccessibleWorkspaces.mockResolvedValue([
      { id: 'workspace-1' },
      { id: 'workspace-2' },
    ] as never);

    await gateway.handleConnection({
      id: 'socket-1',
      join,
      data: {
        user: {
          id: 'user-1',
          email: 'admin@example.com',
          role: 'platform_admin',
        },
      },
    } as never);

    expect(join).toHaveBeenNthCalledWith(1, 'workspace:workspace-1');
    expect(join).toHaveBeenNthCalledWith(2, 'workspace:workspace-2');
  });
});
