import { Repository } from 'typeorm';
import { TaskEntity } from '../tasks/entities/task.entity';
import { TaskStatus } from '../tasks/entities/task-status.enum';
import { AgentUpdatesService } from './agent-updates.service';
import { AgentUpdateRolloutEntity } from './entities/agent-update-rollout.entity';
import { AgentUpdateRolloutTargetEntity } from './entities/agent-update-rollout-target.entity';

type MockRepository<T> = Partial<
  Record<keyof Repository<T>, jest.Mock | Repository<T>[keyof Repository<T>]>
> & {
  createQueryBuilder?: jest.Mock;
  find?: jest.Mock;
  findOne?: jest.Mock;
  save?: jest.Mock;
};

function createActiveTargetsQueryBuilder(
  targets: AgentUpdateRolloutTargetEntity[],
) {
  return {
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(targets),
  };
}

function buildRollout(
  partial: Partial<AgentUpdateRolloutEntity> = {},
): AgentUpdateRolloutEntity {
  return {
    id: 'rollout-1',
    targetVersion: '1.0.0',
    status: 'running',
    rollback: false,
    requestedByUserId: null,
    requestedByEmailSnapshot: null,
    startedAt: new Date('2026-04-02T10:00:00.000Z'),
    completedAt: null,
    cancelledAt: null,
    statusMessage: 'Running rollout',
    createdAt: new Date('2026-04-02T10:00:00.000Z'),
    updatedAt: new Date('2026-04-02T10:00:00.000Z'),
    ...partial,
  };
}

function buildTarget(
  partial: Partial<AgentUpdateRolloutTargetEntity> = {},
): AgentUpdateRolloutTargetEntity {
  return {
    id: 'target-1',
    rolloutId: 'rollout-1',
    nodeId: 'node-1',
    workspaceId: 'workspace-1',
    teamId: null,
    nodeNameSnapshot: 'srv-prod-01',
    previousVersion: '0.9.0',
    targetVersion: '1.0.0',
    status: 'dispatched',
    progressPercent: 5,
    statusMessage: 'Queued update task task-1.',
    taskId: 'task-1',
    sequence: 0,
    dispatchedAt: new Date('2026-04-02T10:00:00.000Z'),
    completedAt: null,
    createdAt: new Date('2026-04-02T10:00:00.000Z'),
    updatedAt: new Date('2026-04-02T10:00:00.000Z'),
    ...partial,
  };
}

function buildTask(partial: Partial<TaskEntity> = {}): TaskEntity {
  return {
    id: 'task-1',
    workspaceId: 'workspace-1',
    nodeId: 'node-1',
    targetTeamId: null,
    targetTeamName: null,
    templateId: null,
    templateName: null,
    type: 'agent.update',
    payload: {},
    status: TaskStatus.FAILED,
    result: null,
    output: null,
    outputTruncated: false,
    leaseUntil: null,
    claimedBy: null,
    claimToken: null,
    startedAt: new Date('2026-04-02T10:00:05.000Z'),
    finishedAt: new Date('2026-04-02T10:00:08.000Z'),
    cancelRequestedAt: null,
    cancelReason: null,
    createdAt: new Date('2026-04-02T10:00:00.000Z'),
    updatedAt: new Date('2026-04-02T10:00:08.000Z'),
    ...partial,
  };
}

describe('AgentUpdatesService', () => {
  let rolloutsRepository: MockRepository<AgentUpdateRolloutEntity>;
  let targetsRepository: MockRepository<AgentUpdateRolloutTargetEntity>;
  let tasksRepository: MockRepository<TaskEntity>;
  let service: AgentUpdatesService;

  beforeEach(() => {
    rolloutsRepository = {
      findOne: jest.fn(),
      save: jest.fn(async (value) => value),
    };
    targetsRepository = {
      createQueryBuilder: jest.fn(),
      save: jest.fn(async (value) => value),
    };
    tasksRepository = {
      find: jest.fn().mockResolvedValue([]),
    };

    service = new AgentUpdatesService(
      rolloutsRepository as unknown as Repository<AgentUpdateRolloutEntity>,
      targetsRepository as unknown as Repository<AgentUpdateRolloutTargetEntity>,
      {} as never,
      tasksRepository as unknown as Repository<TaskEntity>,
      {} as never,
      {} as never,
      {} as never,
      {
        record: jest.fn().mockResolvedValue(undefined),
      } as never,
      {
        record: jest.fn().mockResolvedValue(undefined),
      } as never,
    );
  });

  it('pauses the rollout when the queued agent update task already failed', async () => {
    const rollout = buildRollout();
    const target = buildTarget();
    const task = buildTask({
      output:
        'launch detached updater: exit status 1: sudo: a password is required',
    });

    targetsRepository.createQueryBuilder?.mockReturnValue(
      createActiveTargetsQueryBuilder([target]),
    );
    tasksRepository.find?.mockResolvedValue([task]);
    rolloutsRepository.findOne?.mockResolvedValue(rollout);

    const pausedTargets = await service.reconcileActiveTargets();

    expect(pausedTargets).toBe(1);
    expect(targetsRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: target.id,
        status: 'failed',
        statusMessage: expect.stringContaining(
          'update task task-1 failed before detached updater progress was received',
        ),
      }),
    );
    expect(rolloutsRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: rollout.id,
        status: 'paused',
      }),
    );
  });

  it('times out dispatched targets quickly when no updater progress ever arrives', async () => {
    const rollout = buildRollout();
    const target = buildTarget({
      updatedAt: new Date(Date.now() - 3 * 60 * 1000),
    });

    targetsRepository.createQueryBuilder?.mockReturnValue(
      createActiveTargetsQueryBuilder([target]),
    );
    rolloutsRepository.findOne?.mockResolvedValue(rollout);

    const pausedTargets = await service.reconcileActiveTargets();

    expect(pausedTargets).toBe(1);
    expect(targetsRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: target.id,
        status: 'failed',
        statusMessage: 'srv-prod-01 timed out while waiting for dispatched.',
      }),
    );
    expect(rolloutsRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: rollout.id,
        status: 'paused',
        statusMessage: 'srv-prod-01 timed out while waiting for dispatched.',
      }),
    );
  });
});
