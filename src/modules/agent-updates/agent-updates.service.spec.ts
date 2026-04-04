import { Repository } from 'typeorm';
import { NodeEntity } from '../nodes/entities/node.entity';
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

function createObservedTargetQueryBuilder(
  target: AgentUpdateRolloutTargetEntity | null,
) {
  return {
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(target),
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
  let tasksServiceMock: {
    requestTaskCancellation: jest.Mock;
  };
  let nodesRepository: MockRepository<{
    id: string;
    status?: string;
    agentVersion?: string | null;
  }>;
  let service: AgentUpdatesService;

  beforeEach(() => {
    rolloutsRepository = {
      findOne: jest.fn(),
      save: jest.fn(async (value) => value),
    };
    targetsRepository = {
      createQueryBuilder: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      save: jest.fn(async (value) => value),
    };
    tasksRepository = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(async (value) => value),
    };
    tasksServiceMock = {
      requestTaskCancellation: jest.fn().mockResolvedValue(undefined),
    };
    nodesRepository = {
      findOne: jest.fn().mockResolvedValue(null),
    };

    service = new AgentUpdatesService(
      rolloutsRepository as unknown as Repository<AgentUpdateRolloutEntity>,
      targetsRepository as unknown as Repository<AgentUpdateRolloutTargetEntity>,
      nodesRepository as unknown as Repository<NodeEntity>,
      tasksRepository as unknown as Repository<TaskEntity>,
      {} as never,
      {} as never,
      tasksServiceMock as never,
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
    tasksRepository.findOne = jest.fn().mockResolvedValue(
      buildTask({
        id: 'task-1',
        status: TaskStatus.RUNNING,
      }),
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
    expect(tasksRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'task-1',
        status: TaskStatus.FAILED,
      }),
    );
  });

  it('completes waiting reconnect targets when the node already reports the target version', async () => {
    const rollout = buildRollout({ status: 'paused' });
    const target = buildTarget({
      status: 'waiting_for_reconnect',
      progressPercent: 95,
      statusMessage: 'Waiting for reconnect.',
    });
    const completedTarget = {
      ...target,
      status: 'completed',
      progressPercent: 100,
      statusMessage: 'Agent reconnect confirmed 1.0.0.',
    };

    targetsRepository.createQueryBuilder
      ?.mockReturnValueOnce(createActiveTargetsQueryBuilder([target]))
      .mockReturnValueOnce(createObservedTargetQueryBuilder(target));
    nodesRepository.findOne?.mockResolvedValue({
      id: 'node-1',
      status: 'online',
      agentVersion: '1.0.0',
    });
    targetsRepository.save = jest.fn().mockResolvedValue(completedTarget);
    tasksRepository.findOne = jest.fn().mockResolvedValue(
      buildTask({
        id: 'task-1',
        status: TaskStatus.RUNNING,
        output: null,
        result: null,
      }),
    );
    rolloutsRepository.findOne?.mockResolvedValue(rollout);

    const pausedTargets = await service.reconcileActiveTargets();

    expect(pausedTargets).toBe(0);
    expect(targetsRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: target.id,
        status: 'completed',
        progressPercent: 100,
        statusMessage: 'Agent reconnect confirmed 1.0.0.',
      }),
    );
    expect(tasksRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'task-1',
        status: TaskStatus.SUCCESS,
        output: 'Agent reconnect confirmed 1.0.0.',
      }),
    );
  });

  it('re-observes node version when waiting_for_reconnect arrives after the node is already updated', async () => {
    const rollout = buildRollout();
    const target = buildTarget({
      status: 'restarting',
      progressPercent: 90,
      statusMessage: 'Restarting noderax-agent.service.',
    });

    targetsRepository.findOne = jest.fn().mockResolvedValue(target);
    targetsRepository.save = jest.fn(async (value) => value);
    rolloutsRepository.findOne?.mockResolvedValue(rollout);
    nodesRepository.findOne?.mockResolvedValue({
      id: 'node-1',
      agentVersion: '1.0.0',
    });
    targetsRepository.createQueryBuilder?.mockReturnValue(
      createObservedTargetQueryBuilder({
        ...target,
        status: 'waiting_for_reconnect',
        progressPercent: 95,
        statusMessage: 'Restart requested. Waiting for reconnect.',
      }),
    );

    await service.handleAgentProgress(
      target.id,
      {
        status: 'waiting_for_reconnect',
        progressPercent: 95,
        message:
          'Restart requested. Waiting for the noderax-agent.service heartbeat to confirm agent 1.0.0.',
      },
      {
        nodeId: 'node-1',
      } as never,
    );

    expect(targetsRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: target.id,
        status: 'waiting_for_reconnect',
        progressPercent: 95,
      }),
    );
    expect(targetsRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: target.id,
        status: 'completed',
        progressPercent: 100,
        statusMessage: 'Agent reconnect confirmed 1.0.0.',
      }),
    );
  });

  it('cancels pending and active targets and requests cancellation for active task ids', async () => {
    const rollout = buildRollout({ status: 'running' });
    const pendingTarget = buildTarget({
      id: 'target-pending',
      taskId: null,
      status: 'pending',
      progressPercent: 0,
    });
    const activeTarget = buildTarget({
      id: 'target-active',
      taskId: 'task-active',
      status: 'waiting_for_reconnect',
      progressPercent: 95,
    });
    const completedTarget = buildTarget({
      id: 'target-completed',
      status: 'completed',
      progressPercent: 100,
      completedAt: new Date('2026-04-02T10:04:00.000Z'),
    });

    rolloutsRepository.findOne = jest.fn().mockResolvedValue(rollout);
    rolloutsRepository.save = jest.fn(async (value) => value);
    targetsRepository.find = jest
      .fn()
      .mockResolvedValueOnce([pendingTarget, activeTarget, completedTarget])
      .mockResolvedValueOnce([pendingTarget, activeTarget, completedTarget]);
    targetsRepository.save = jest.fn(async (value) => value);

    await service.cancelRollout('rollout-1', {
      actorType: 'user',
      actorUserId: 'user-1',
      actorEmailSnapshot: 'ops@noderax.dev',
      ipAddress: null,
      userAgent: null,
    });

    expect(targetsRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'target-pending',
        status: 'cancelled',
        progressPercent: 0,
      }),
    );
    expect(targetsRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'target-active',
        status: 'cancelled',
        progressPercent: 95,
      }),
    );
    expect(tasksServiceMock.requestTaskCancellation).toHaveBeenCalledWith(
      'task-active',
      expect.objectContaining({
        reason: 'Rollout cancelled by operator.',
      }),
      activeTarget.workspaceId,
    );
  });

  it('does not consider cancelled rollouts when observing node version confirmations', async () => {
    const queryBuilder = createObservedTargetQueryBuilder(null);
    targetsRepository.createQueryBuilder?.mockReturnValue(queryBuilder);

    await service.observeNodeVersion({
      id: 'node-1',
      agentVersion: '1.0.0',
    });

    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'rollout.status IN (:...rolloutStatuses)',
      expect.objectContaining({
        rolloutStatuses: ['running', 'paused'],
      }),
    );
  });
});
