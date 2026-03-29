/// <reference types="jest" />

import { Server } from 'socket.io';
import { TasksService } from '../tasks/tasks.service';
import { TerminalSessionsService } from '../terminal-sessions/terminal-sessions.service';
import { AgentRealtimeGateway } from './agent-realtime.gateway';
import { AgentRealtimeService } from './agent-realtime.service';

describe('AgentRealtimeGateway', () => {
  let gateway: AgentRealtimeGateway;
  let tasksService: jest.Mocked<TasksService>;
  let agentRealtimeService: jest.Mocked<AgentRealtimeService>;
  let terminalSessionsService: jest.Mocked<TerminalSessionsService>;

  beforeEach(() => {
    tasksService = {
      acknowledgeForAgent: jest.fn(),
      startForAgent: jest.fn(),
      appendLogForAgent: jest.fn(),
      completeForAgent: jest.fn(),
    } as unknown as jest.Mocked<TasksService>;

    agentRealtimeService = {
      bindSocketEmitter: jest.fn(),
      bindSocketDisconnect: jest.fn(),
      getSessionForSocket: jest.fn().mockReturnValue({
        nodeId: 'b7f88611-b63e-4c95-9f37-4afb5c0cf275',
        agentToken: 'agent-token',
      }),
      registerLifecycleEvent: jest.fn(),
      incrementCounter: jest.fn(),
      handleSocketDisconnect: jest.fn(),
      authenticateSocket: jest.fn(),
      dispatchQueuedTasks: jest.fn(),
      registerPing: jest.fn(),
      ingestRealtimeMetrics: jest.fn(),
    } as unknown as jest.Mocked<AgentRealtimeService>;

    terminalSessionsService = {
      handleAgentOpened: jest.fn(),
      handleAgentOutput: jest.fn(),
      handleAgentExited: jest.fn(),
      handleAgentError: jest.fn(),
    } as unknown as jest.Mocked<TerminalSessionsService>;

    gateway = new AgentRealtimeGateway(
      tasksService,
      agentRealtimeService,
      terminalSessionsService,
    );
    gateway.server = {
      sockets: {
        sockets: new Map(),
      },
    } as unknown as Server;
  });

  it('skips duplicate task.accepted lifecycle events', async () => {
    agentRealtimeService.registerLifecycleEvent.mockResolvedValue(false);

    const response = await gateway.handleTaskAccepted(
      { id: 'socket-1', disconnect: jest.fn() } as never,
      {
        type: 'task.accepted',
        taskId: 'ec9f97f2-7b56-4a7e-a7cb-5c957e9d32d8',
        timestamp: '2026-03-20T18:20:00.000Z',
      },
    );

    expect(response).toEqual({
      ok: true,
      duplicate: true,
      taskId: 'ec9f97f2-7b56-4a7e-a7cb-5c957e9d32d8',
    });
    expect(tasksService.acknowledgeForAgent).not.toHaveBeenCalled();
  });
});
