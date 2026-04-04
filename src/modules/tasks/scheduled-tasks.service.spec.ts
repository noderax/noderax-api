import { ScheduledTasksService } from './scheduled-tasks.service';
import { ScheduledTaskEntity } from './entities/scheduled-task.entity';
import { UserRole } from '../users/entities/user-role.enum';

describe('ScheduledTasksService', () => {
  const save = jest.fn();
  const create = jest.fn((value) => value);
  const findOne = jest.fn();
  const remove = jest.fn();
  const update = jest.fn();
  const find = jest.fn();

  const repository = {
    save,
    create,
    findOne,
    remove,
    update,
    find,
    createQueryBuilder: jest.fn(),
  };

  const usersRepository = {
    findOne: jest.fn(),
    find: jest.fn(),
  };

  const nodesService = {
    ensureExists: jest.fn(),
    findOneOrFail: jest.fn(),
    listTeamOwnedNodes: jest.fn(),
    assertNodeAllowsTaskRoot: jest.fn(),
  };

  const eventsService = {
    record: jest.fn(),
  };

  const tasksService = {
    createScheduledShellTask: jest.fn(),
  };

  const workspacesService = {
    findOneOrFail: jest.fn(),
    assertWorkspaceWritable: jest.fn().mockResolvedValue({
      id: 'workspace-1',
      defaultTimezone: 'UTC',
    }),
    getDefaultWorkspaceOrFail: jest.fn().mockResolvedValue({
      id: 'workspace-1',
      defaultTimezone: 'UTC',
    }),
    findMembershipForUser: jest.fn(),
  };

  const auditLogsService = {
    record: jest.fn(),
  };

  const service = new ScheduledTasksService(
    repository as never,
    usersRepository as never,
    {} as never,
    nodesService as never,
    eventsService as never,
    tasksService as never,
    workspacesService as never,
    auditLogsService as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('enables schedules by recomputing the next run and clearing lease state', async () => {
    const schedule = buildSchedule({
      enabled: false,
      nextRunAt: null,
      claimToken: 'claim-token',
      claimedBy: 'runner-1',
      leaseUntil: new Date('2026-03-26T11:59:00.000Z'),
    });
    findOne.mockResolvedValue(schedule);
    save.mockImplementation(async (value) => value);

    const result = await service.updateEnabled(schedule.id, {
      enabled: true,
    });

    expect(result.enabled).toBe(true);
    expect(result.nextRunAt).toBeInstanceOf(Date);
    expect(result.claimToken).toBeNull();
    expect(result.claimedBy).toBeNull();
    expect(result.leaseUntil).toBeNull();
  });

  it('disables schedules by clearing next run and lease state', async () => {
    const schedule = buildSchedule({
      enabled: true,
      nextRunAt: new Date('2026-03-26T12:00:00.000Z'),
      claimToken: 'claim-token',
      claimedBy: 'api-1',
      leaseUntil: new Date('2026-03-26T11:59:00.000Z'),
    });
    findOne.mockResolvedValue(schedule);
    save.mockImplementation(async (value) => value);

    const result = await service.updateEnabled(schedule.id, {
      enabled: false,
    });

    expect(result.enabled).toBe(false);
    expect(result.nextRunAt).toBeNull();
    expect(result.claimToken).toBeNull();
    expect(result.claimedBy).toBeNull();
    expect(result.leaseUntil).toBeNull();
  });

  it('queues a scheduled shell task and clears the last error on success', async () => {
    const schedule = buildSchedule({
      claimToken: 'claim-token',
      nextRunAt: new Date('2026-03-26T12:00:00.000Z'),
    });
    nodesService.findOneOrFail.mockResolvedValue({
      id: schedule.nodeId,
      maintenanceMode: false,
    });
    tasksService.createScheduledShellTask.mockResolvedValue({
      id: 'task-1',
    });

    const result = await service.triggerClaimedSchedule(schedule);

    expect(result).toEqual({ ok: true });
    expect(tasksService.createScheduledShellTask).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeId: schedule.nodeId,
        workspaceId: schedule.workspaceId,
        scheduleId: schedule.id,
        scheduleName: schedule.name,
        command: schedule.command,
      }),
    );
    expect(update).toHaveBeenCalledWith(
      {
        id: schedule.id,
        claimToken: schedule.claimToken,
      },
      expect.objectContaining({
        lastError: null,
        lastRunTaskId: 'task-1',
        claimToken: null,
        claimedBy: null,
        leaseUntil: null,
      }),
    );
  });

  it('stores lastError when task queueing fails', async () => {
    const schedule = buildSchedule({
      claimToken: 'claim-token',
    });
    nodesService.findOneOrFail.mockResolvedValue({
      id: schedule.nodeId,
      maintenanceMode: false,
    });
    tasksService.createScheduledShellTask.mockRejectedValue(
      new Error('node missing'),
    );

    const result = await service.triggerClaimedSchedule(schedule);

    expect(result).toEqual({
      ok: false,
      error: 'node missing',
    });
    expect(update).toHaveBeenCalledWith(
      {
        id: schedule.id,
        claimToken: schedule.claimToken,
      },
      expect.objectContaining({
        lastError: 'node missing',
        claimToken: null,
        claimedBy: null,
        leaseUntil: null,
      }),
    );
  });

  it('allows platform admins to create schedules in the default workspace without an explicit membership lookup', async () => {
    usersRepository.findOne.mockResolvedValue({
      id: 'owner-1',
      role: UserRole.PLATFORM_ADMIN,
      name: 'Platform Admin',
    });
    nodesService.ensureExists.mockResolvedValue({
      id: 'node-1',
      workspaceId: 'workspace-1',
    });
    save.mockImplementation(async (value) => ({
      id: 'schedule-1',
      createdAt: new Date('2026-03-26T10:00:00.000Z'),
      updatedAt: new Date('2026-03-26T10:00:00.000Z'),
      ...value,
    }));

    const result = await service.create('owner-1', undefined, {
      nodeId: 'node-1',
      name: 'Daily hostname check',
      command: 'hostname',
      cadence: 'daily',
      minute: 15,
      hour: 3,
    });

    expect(result.workspaceId).toBe('workspace-1');
    expect(workspacesService.getDefaultWorkspaceOrFail).toHaveBeenCalled();
    expect(workspacesService.findMembershipForUser).not.toHaveBeenCalled();
    expect(nodesService.ensureExists).toHaveBeenCalledWith(
      'node-1',
      'workspace-1',
    );
  });
});

function buildSchedule(
  partial: Partial<ScheduledTaskEntity>,
): ScheduledTaskEntity {
  return {
    id: 'b6c8b6be-e54d-46d7-816c-9732cf5efe7d',
    workspaceId: 'workspace-1',
    nodeId: 'b7f88611-b63e-4c95-9f37-4afb5c0cf275',
    name: 'Daily hostname check',
    command: 'hostname',
    cadence: 'daily',
    minute: 15,
    hour: 3,
    dayOfWeek: null,
    intervalMinutes: null,
    timezone: 'UTC',
    timezoneSource: 'workspace',
    ownerUserId: 'owner-1',
    ownerName: 'Noderax Admin',
    isLegacy: false,
    enabled: true,
    nextRunAt: new Date('2026-03-27T03:15:00.000Z'),
    lastRunAt: null,
    lastRunTaskId: null,
    lastError: null,
    runAsRoot: false,
    leaseUntil: null,
    claimedBy: null,
    claimToken: null,
    createdAt: new Date('2026-03-26T10:00:00.000Z'),
    updatedAt: new Date('2026-03-26T10:00:00.000Z'),
    ...partial,
  };
}
