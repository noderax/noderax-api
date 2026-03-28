import { TASK_TYPES } from '../../common/constants/task-types.constants';
import { TaskStatus } from './entities/task-status.enum';
import { TaskEntity } from './entities/task.entity';
import { TasksService } from './tasks.service';

function createService(): TasksService {
  return new TasksService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {
      getOrThrow: jest.fn().mockReturnValue({
        enableRealtimeTaskDispatch: false,
        taskClaimLeaseSeconds: 60,
      }),
    } as never,
    {} as never,
    {} as never,
  );
}

function buildTask(partial: Partial<TaskEntity>): TaskEntity {
  return {
    id: 'ec9f97f2-7b56-4a7e-a7cb-5c957e9d32d8',
    workspaceId: 'workspace-1',
    nodeId: 'b7f88611-b63e-4c95-9f37-4afb5c0cf275',
    type: TASK_TYPES.PACKAGE_LIST,
    payload: {},
    status: TaskStatus.SUCCESS,
    result: null,
    output: null,
    outputTruncated: false,
    leaseUntil: null,
    claimedBy: null,
    claimToken: null,
    startedAt: null,
    finishedAt: null,
    cancelRequestedAt: null,
    cancelReason: null,
    createdAt: new Date('2026-03-18T10:18:00.000Z'),
    updatedAt: new Date('2026-03-18T10:18:01.000Z'),
    ...partial,
  };
}

describe('TasksService.handlePackageResult', () => {
  let tasksService: TasksService;

  beforeEach(() => {
    tasksService = createService();
  });

  it('normalizes package list results', () => {
    const result = tasksService.handlePackageResult(
      buildTask({
        type: TASK_TYPES.PACKAGE_LIST,
        result: {
          packages: [
            {
              name: 'nginx',
              version: '1.24.0-2ubuntu7',
              arch: 'amd64',
              summary: 'small, powerful, scalable web/proxy server',
            },
          ],
        },
      }),
    );

    expect(result).toEqual({
      operation: TASK_TYPES.PACKAGE_LIST,
      packages: [
        {
          name: 'nginx',
          version: '1.24.0-2ubuntu7',
          architecture: 'amd64',
          description: 'small, powerful, scalable web/proxy server',
        },
      ],
    });
  });

  it('normalizes search results from the results field', () => {
    const result = tasksService.handlePackageResult(
      buildTask({
        type: TASK_TYPES.PACKAGE_SEARCH,
        payload: {
          term: 'nginx',
        },
        result: {
          results: [
            {
              package: 'nginx',
              version: '1.24.0-2ubuntu7',
              description: 'small, powerful, scalable web/proxy server',
            },
          ],
        },
      }),
    );

    expect(result).toEqual({
      operation: TASK_TYPES.PACKAGE_SEARCH,
      results: [
        {
          name: 'nginx',
          version: '1.24.0-2ubuntu7',
          description: 'small, powerful, scalable web/proxy server',
        },
      ],
    });
  });

  it('returns null when a read task lacks structured result data', () => {
    const result = tasksService.handlePackageResult(
      buildTask({
        type: TASK_TYPES.PACKAGE_SEARCH,
        result: {
          output: 'nginx - package metadata',
        },
      }),
    );

    expect(result).toBeNull();
  });

  it('normalizes mutation tasks from payload metadata', () => {
    const result = tasksService.handlePackageResult(
      buildTask({
        type: TASK_TYPES.PACKAGE_PURGE,
        payload: {
          names: ['nginx'],
          purge: true,
        },
        output: 'Purging nginx configuration files',
      }),
    );

    expect(result).toEqual({
      operation: TASK_TYPES.PACKAGE_PURGE,
      names: ['nginx'],
      purge: true,
      output: 'Purging nginx configuration files',
    });
  });
});

describe('TasksService.createScheduledShellTask', () => {
  it('queues a shell.exec task with schedule metadata in the payload', async () => {
    const taskRepository = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({
        id: 'ec9f97f2-7b56-4a7e-a7cb-5c957e9d32d8',
        result: null,
        output: null,
        outputTruncated: false,
        startedAt: null,
        finishedAt: null,
        cancelRequestedAt: null,
        cancelReason: null,
        leaseUntil: null,
        claimedBy: null,
        claimToken: null,
        status: TaskStatus.QUEUED,
        createdAt: new Date('2026-03-18T10:18:00.000Z'),
        updatedAt: new Date('2026-03-18T10:18:01.000Z'),
        ...value,
      })),
    };
    const eventsService = {
      record: jest.fn(),
    };
    const realtimeGateway = {
      emitTaskCreated: jest.fn(),
    };
    const redisService = {
      publish: jest.fn(),
      getInstanceId: jest.fn().mockReturnValue('instance-1'),
    };
    const nodesService = {
      ensureExists: jest.fn().mockResolvedValue({
        id: 'b7f88611-b63e-4c95-9f37-4afb5c0cf275',
        hostname: 'srv-test-01',
      }),
    };
    const agentRealtimeService = {
      dispatchTaskToNode: jest.fn(),
    };
    const tasksService = new TasksService(
      taskRepository as never,
      {} as never,
      {} as never,
      nodesService as never,
      eventsService as never,
      {} as never,
      realtimeGateway as never,
      redisService as never,
      agentRealtimeService as never,
      {
        getOrThrow: jest.fn().mockReturnValue({
          enableRealtimeTaskDispatch: false,
          taskClaimLeaseSeconds: 60,
        }),
      } as never,
      {} as never,
    );

    const task = await tasksService.createScheduledShellTask({
      nodeId: 'b7f88611-b63e-4c95-9f37-4afb5c0cf275',
      scheduleId: 'schedule-1',
      scheduleName: 'Daily hostname check',
      command: 'hostname',
    });

    expect(task.type).toBe('shell.exec');
    expect(task.payload).toEqual({
      title: 'Daily hostname check',
      command: 'hostname',
      scheduleId: 'schedule-1',
      scheduleName: 'Daily hostname check',
    });
  });
});
