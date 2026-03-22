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
    {
      getOrThrow: jest.fn().mockReturnValue({
        enableRealtimeTaskDispatch: false,
        taskClaimLeaseSeconds: 60,
      }),
    } as never,
  );
}

function buildTask(partial: Partial<TaskEntity>): TaskEntity {
  return {
    id: 'ec9f97f2-7b56-4a7e-a7cb-5c957e9d32d8',
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
