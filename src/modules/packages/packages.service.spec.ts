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
});
