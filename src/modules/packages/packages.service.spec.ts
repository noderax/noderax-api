import { TASK_TYPES } from '../../common/constants/task-types.constants';
import { TaskStatus } from '../tasks/entities/task-status.enum';
import { TasksService } from '../tasks/tasks.service';
import { PackagesService } from './packages.service';

describe('PackagesService compatibility hardening', () => {
  let tasksService: jest.Mocked<TasksService>;
  let service: PackagesService;

  beforeEach(() => {
    tasksService = {
      create: jest.fn().mockResolvedValue({
        id: 'task-1',
        status: TaskStatus.QUEUED,
        nodeId: 'node-1',
      }),
      findOneOrFail: jest.fn().mockResolvedValue({
        id: 'task-1',
        status: TaskStatus.QUEUED,
        nodeId: 'node-1',
      }),
      waitForTerminalState: jest.fn(),
      handlePackageResult: jest.fn(),
    } as unknown as jest.Mocked<TasksService>;

    service = new PackagesService(tasksService);
  });

  it('queues package search payload with both term and query fields', async () => {
    tasksService.waitForTerminalState.mockResolvedValue(null);

    await service.search({
      nodeId: 'node-1',
      term: 'nginx',
    });

    expect(tasksService.create).toHaveBeenCalledWith({
      nodeId: 'node-1',
      type: TASK_TYPES.PACKAGE_SEARCH,
      payload: {
        term: 'nginx',
        query: 'nginx',
      },
    });
  });

  it('queues install payload with names, packages and package aliases', async () => {
    await service.install('node-1', {
      names: ['nginx'],
      purge: false,
    });

    expect(tasksService.create).toHaveBeenCalledWith({
      nodeId: 'node-1',
      type: TASK_TYPES.PACKAGE_INSTALL,
      payload: {
        names: ['nginx'],
        packages: ['nginx'],
        package: 'nginx',
        purge: false,
      },
    });
  });

  it('normalizes purge removals to packageRemove while preserving purge intent in payload', async () => {
    await service.remove('node-1', 'nginx', {
      purge: 'true',
    });

    expect(tasksService.create).toHaveBeenCalledWith({
      nodeId: 'node-1',
      type: TASK_TYPES.PACKAGE_REMOVE,
      payload: {
        names: ['nginx'],
        packages: ['nginx'],
        package: 'nginx',
        purge: true,
      },
    });
  });

  it('returns accepted response aliases id/status along with canonical taskId/taskStatus', async () => {
    const result = await service.install('node-1', {
      names: ['nginx'],
      purge: false,
    });

    expect(result).toMatchObject({
      taskId: 'task-1',
      taskStatus: TaskStatus.QUEUED,
      id: 'task-1',
      status: TaskStatus.QUEUED,
    });
  });

  it('falls back to parsing dpkg -l output when structured package list is missing', async () => {
    tasksService.waitForTerminalState.mockResolvedValue({
      id: 'task-list-1',
      nodeId: 'node-1',
      type: TASK_TYPES.PACKAGE_LIST,
      status: TaskStatus.SUCCESS,
      result: null,
      output:
        'ii  adduser 3.137ubuntu1 all add and remove users and groups\n' +
        'ii  bash 5.2.21-2ubuntu4 amd64 GNU Bourne Again SHell',
    } as never);
    tasksService.handlePackageResult.mockReturnValue(null);

    const response = await service.listInstalled('node-1');

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      taskId: 'task-list-1',
      taskStatus: TaskStatus.SUCCESS,
      packages: [
        {
          name: 'adduser',
          version: '3.137ubuntu1',
          architecture: 'all',
        },
        {
          name: 'bash',
          version: '5.2.21-2ubuntu4',
          architecture: 'amd64',
        },
      ],
      error: null,
    });
  });

  it('falls back to parsing apt list --installed output when structured package list is missing', async () => {
    tasksService.waitForTerminalState.mockResolvedValue({
      id: 'task-list-2',
      nodeId: 'node-1',
      type: TASK_TYPES.PACKAGE_LIST,
      status: TaskStatus.SUCCESS,
      result: null,
      output:
        'Listing...\n' +
        'adduser/noble,now 3.137ubuntu1 all [installed,automatic]\n' +
        'bash/noble-updates,now 5.2.21-2ubuntu4 amd64 [installed]',
    } as never);
    tasksService.handlePackageResult.mockReturnValue(null);

    const response = await service.listInstalled('node-1');

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      taskId: 'task-list-2',
      taskStatus: TaskStatus.SUCCESS,
      packages: [
        {
          name: 'adduser',
          version: '3.137ubuntu1',
          architecture: 'all',
          description: null,
        },
        {
          name: 'bash',
          version: '5.2.21-2ubuntu4',
          architecture: 'amd64',
          description: null,
        },
      ],
      error: null,
    });
  });

  it('prefers structured package list over output fallback when both are available', async () => {
    tasksService.waitForTerminalState.mockResolvedValue({
      id: 'task-list-3',
      nodeId: 'node-1',
      type: TASK_TYPES.PACKAGE_LIST,
      status: TaskStatus.SUCCESS,
      result: { packages: [{ name: 'curl' }] },
      output: 'ii  bash 5.2.21-2ubuntu4 amd64 GNU Bourne Again SHell',
    } as never);
    tasksService.handlePackageResult.mockReturnValue({
      operation: TASK_TYPES.PACKAGE_LIST,
      packages: [
        {
          name: 'curl',
          version: '8.5.0-2ubuntu10',
          architecture: 'amd64',
          description:
            'command line tool for transferring data with URL syntax',
        },
      ],
    });

    const response = await service.listInstalled('node-1');

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      taskId: 'task-list-3',
      taskStatus: TaskStatus.SUCCESS,
      packages: [
        {
          name: 'curl',
          version: '8.5.0-2ubuntu10',
        },
      ],
      error: null,
    });
  });
});
