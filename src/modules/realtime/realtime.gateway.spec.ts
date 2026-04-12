/// <reference types="jest" />

import { Server } from 'socket.io';
import { REALTIME_EVENTS } from '../../common/constants/realtime.constants';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeAuthService } from './services/realtime-auth.service';

describe('RealtimeGateway', () => {
  let gateway: RealtimeGateway;
  let realtimeAuthService: jest.Mocked<RealtimeAuthService>;
  let roomEmitter: { emit: jest.Mock };
  let server: { to: jest.Mock };

  beforeEach(() => {
    realtimeAuthService = {
      authenticateSocket: jest.fn(),
    } as unknown as jest.Mocked<RealtimeAuthService>;

    roomEmitter = {
      emit: jest.fn(),
    };

    server = {
      to: jest.fn().mockReturnValue(roomEmitter),
    };

    gateway = new RealtimeGateway(realtimeAuthService);
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
});
