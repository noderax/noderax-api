import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { In, Repository } from 'typeorm';
import { SYSTEM_EVENT_TYPES } from '../../common/constants/system-event.constants';
import { RequestAuditContext } from '../../common/types/request-audit-context.type';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { EventSeverity } from '../events/entities/event-severity.enum';
import { EventsService } from '../events/events.service';
import { NodesService } from '../nodes/nodes.service';
import { UserEntity } from '../users/entities/user.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { CreateBatchScheduledTaskDto } from './dto/create-batch-scheduled-task.dto';
import { CreateScheduledTaskDto } from './dto/create-scheduled-task.dto';
import { UpdateScheduledTaskDto } from './dto/update-scheduled-task.dto';
import { ScheduledTaskEntity } from './entities/scheduled-task.entity';
import { TaskTemplateEntity } from './entities/task-template.entity';
import {
  computeNextScheduledRun,
  describeScheduledTask,
  SCHEDULED_TASK_RUNNER_LEASE_MS,
} from './scheduled-task.utils';
import { TasksService } from './tasks.service';

@Injectable()
export class ScheduledTasksService {
  private readonly logger = new Logger(ScheduledTasksService.name);

  constructor(
    @InjectRepository(ScheduledTaskEntity)
    private readonly scheduledTasksRepository: Repository<ScheduledTaskEntity>,
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
    @InjectRepository(TaskTemplateEntity)
    private readonly taskTemplatesRepository: Repository<TaskTemplateEntity>,
    private readonly nodesService: NodesService,
    private readonly eventsService: EventsService,
    private readonly tasksService: TasksService,
    private readonly workspacesService: WorkspacesService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async create(
    ownerUserId: string,
    workspaceId: string | undefined,
    createScheduledTaskDto: CreateScheduledTaskDto,
    context?: RequestAuditContext,
  ): Promise<ScheduledTaskEntity> {
    const owner = await this.findOwnerOrFail(ownerUserId);
    const workspace = await this.resolveWorkspace(workspaceId, owner);
    const normalized = this.normalizeScheduleInput(createScheduledTaskDto);
    const [saved] = createScheduledTaskDto.teamId
      ? await this.createSchedulesForTeam(
          owner,
          workspace,
          createScheduledTaskDto.teamId,
          normalized,
          createScheduledTaskDto.templateId,
          context,
        )
      : await this.createSchedulesForNodes(
          owner,
          workspace,
          [createScheduledTaskDto.nodeId!],
          normalized,
          createScheduledTaskDto.templateId,
          context,
        );

    return saved;
  }

  async createBatch(
    ownerUserId: string,
    workspaceId: string | undefined,
    createBatchScheduledTaskDto: CreateBatchScheduledTaskDto,
    context?: RequestAuditContext,
  ): Promise<ScheduledTaskEntity[]> {
    const owner = await this.findOwnerOrFail(ownerUserId);
    const workspace = await this.resolveWorkspace(workspaceId, owner);
    const normalized = this.normalizeScheduleInput(createBatchScheduledTaskDto);

    return this.createSchedulesForNodes(
      owner,
      workspace,
      createBatchScheduledTaskDto.nodeIds,
      normalized,
      createBatchScheduledTaskDto.templateId,
      context,
    );
  }

  async findAll(workspaceId?: string): Promise<ScheduledTaskEntity[]> {
    const schedules = await this.scheduledTasksRepository
      .createQueryBuilder('schedule')
      .where(
        workspaceId ? 'schedule.workspaceId = :workspaceId' : '1=1',
        workspaceId ? { workspaceId } : {},
      )
      .orderBy('schedule.enabled', 'DESC')
      .addOrderBy('schedule.nextRunAt', 'ASC', 'NULLS LAST')
      .addOrderBy('schedule.createdAt', 'ASC')
      .getMany();

    return this.populateScheduleMetadata(schedules);
  }

  async findOneOrFail(
    id: string,
    workspaceId?: string,
  ): Promise<ScheduledTaskEntity> {
    const scheduledTask = await this.scheduledTasksRepository.findOne({
      where: workspaceId ? { id, workspaceId } : { id },
    });

    if (!scheduledTask) {
      throw new NotFoundException(`Scheduled task ${id} was not found`);
    }

    const [decoratedSchedule] = await this.populateScheduleMetadata([
      scheduledTask,
    ]);
    return decoratedSchedule;
  }

  async updateEnabled(
    id: string,
    dto: UpdateScheduledTaskDto,
    workspaceId?: string,
  ): Promise<ScheduledTaskEntity> {
    const scheduledTask = await this.findOneOrFail(id, workspaceId);
    await this.workspacesService.assertWorkspaceWritable(
      scheduledTask.workspaceId,
    );
    scheduledTask.enabled = dto.enabled;
    scheduledTask.claimToken = null;
    scheduledTask.claimedBy = null;
    scheduledTask.leaseUntil = null;

    if (dto.enabled) {
      scheduledTask.nextRunAt = computeNextScheduledRun(
        scheduledTask,
        new Date(),
      );
    } else {
      scheduledTask.nextRunAt = null;
    }

    const saved = await this.scheduledTasksRepository.save(scheduledTask);
    saved.ownerName = scheduledTask.ownerName ?? null;
    saved.isLegacy = saved.timezoneSource === 'legacy_fixed';

    await this.eventsService.record({
      nodeId: saved.nodeId,
      type: SYSTEM_EVENT_TYPES.TASK_SCHEDULE_UPDATED,
      severity: EventSeverity.INFO,
      message: dto.enabled
        ? `Scheduled task ${saved.name} enabled. ${describeScheduledTask(saved)}`
        : `Scheduled task ${saved.name} disabled.`,
      metadata: {
        scheduleId: saved.id,
        scheduleName: saved.name,
        enabled: saved.enabled,
        ownerUserId: saved.ownerUserId,
        timezone: saved.timezone,
        nextRunAt: saved.nextRunAt?.toISOString() ?? null,
        targetTeamId: saved.targetTeamId,
      },
    });

    return saved;
  }

  async delete(
    id: string,
    workspaceId?: string,
  ): Promise<{ deleted: true; id: string }> {
    const scheduledTask = await this.findOneOrFail(id, workspaceId);
    await this.workspacesService.assertWorkspaceWritable(
      scheduledTask.workspaceId,
    );
    await this.scheduledTasksRepository.remove(scheduledTask);

    await this.eventsService.record({
      nodeId: scheduledTask.nodeId,
      type: SYSTEM_EVENT_TYPES.TASK_SCHEDULE_DELETED,
      severity: EventSeverity.WARNING,
      message: `Scheduled task ${scheduledTask.name} deleted.`,
      metadata: {
        scheduleId: scheduledTask.id,
        scheduleName: scheduledTask.name,
        targetTeamId: scheduledTask.targetTeamId,
      },
    });

    return {
      deleted: true,
      id,
    };
  }

  async claimNextDueSchedule(
    claimedBy: string,
  ): Promise<ScheduledTaskEntity | null> {
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + SCHEDULED_TASK_RUNNER_LEASE_MS);
    while (true) {
      const candidate = await this.scheduledTasksRepository
        .createQueryBuilder('schedule')
        .select('schedule.id', 'id')
        .innerJoin(
          'workspaces',
          'workspace',
          'workspace.id = schedule.workspaceId',
        )
        .where('schedule.enabled = true')
        .andWhere('schedule.nextRunAt IS NOT NULL')
        .andWhere('schedule.nextRunAt <= :now', { now })
        .andWhere('workspace.isArchived = false')
        .andWhere(
          '(schedule.leaseUntil IS NULL OR schedule.leaseUntil <= :now)',
          {
            now,
          },
        )
        .orderBy('schedule.nextRunAt', 'ASC')
        .addOrderBy('schedule.createdAt', 'ASC')
        .limit(1)
        .getRawOne<{ id: string }>();

      if (!candidate?.id) {
        return null;
      }

      const claimToken = randomUUID();
      const updateResult = await this.scheduledTasksRepository
        .createQueryBuilder()
        .update(ScheduledTaskEntity)
        .set({
          claimedBy,
          claimToken,
          leaseUntil,
          updatedAt: now,
        })
        .where('id = :id', { id: candidate.id })
        .andWhere('enabled = true')
        .andWhere('nextRunAt IS NOT NULL')
        .andWhere('nextRunAt <= :now', { now })
        .andWhere('(leaseUntil IS NULL OR leaseUntil <= :now)', { now })
        .returning('*')
        .execute();

      if ((updateResult.affected ?? 0) === 0) {
        continue;
      }

      const row = updateResult.raw?.[0] as ScheduledTaskEntity | undefined;
      if (row?.id) {
        return row;
      }

      return this.scheduledTasksRepository.findOne({
        where: { claimToken },
      });
    }
  }

  async triggerClaimedSchedule(
    scheduledTask: ScheduledTaskEntity,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      const createdTaskIds: string[] = [];
      const targets = scheduledTask.targetTeamId
        ? (
            await this.nodesService.listTeamOwnedNodes(
              scheduledTask.workspaceId,
              scheduledTask.targetTeamId,
            )
          ).filter((node) => !node.maintenanceMode)
        : scheduledTask.nodeId
          ? [
              await this.nodesService.findOneOrFail(
                scheduledTask.nodeId,
                scheduledTask.workspaceId,
              ),
            ]
          : [];

      if (targets.length === 0) {
        const nextRunAt = scheduledTask.nextRunAt
          ? computeNextScheduledRun(scheduledTask, scheduledTask.nextRunAt)
          : computeNextScheduledRun(scheduledTask, new Date());

        await this.scheduledTasksRepository.update(
          {
            id: scheduledTask.id,
            claimToken: scheduledTask.claimToken,
          },
          {
            lastError:
              'No eligible nodes matched the scheduled task target at execution time.',
            nextRunAt,
            claimToken: null,
            claimedBy: null,
            leaseUntil: null,
          },
        );

        return { ok: true };
      }

      for (const target of targets) {
        if (scheduledTask.runAsRoot) {
          this.nodesService.assertNodeAllowsTaskRoot(target);
        }
        const createdTask = await this.tasksService.createScheduledShellTask({
          nodeId: target.id,
          workspaceId: scheduledTask.workspaceId,
          scheduleId: scheduledTask.id,
          scheduleName: scheduledTask.name,
          command: scheduledTask.command,
          runAsRoot: scheduledTask.runAsRoot,
          targetTeamId: scheduledTask.targetTeamId,
          targetTeamName: scheduledTask.targetTeamName ?? null,
          templateId: scheduledTask.templateId,
          templateName: scheduledTask.templateName,
        });
        createdTaskIds.push(createdTask.id);
      }

      const nextRunAt = scheduledTask.nextRunAt
        ? computeNextScheduledRun(scheduledTask, scheduledTask.nextRunAt)
        : computeNextScheduledRun(scheduledTask, new Date());

      await this.scheduledTasksRepository.update(
        {
          id: scheduledTask.id,
          claimToken: scheduledTask.claimToken,
        },
        {
          lastRunAt: new Date(),
          lastRunTaskId: createdTaskIds[0] ?? null,
          lastError: null,
          nextRunAt,
          claimToken: null,
          claimedBy: null,
          leaseUntil: null,
        },
      );

      await this.eventsService.record({
        workspaceId: scheduledTask.workspaceId,
        nodeId: scheduledTask.nodeId,
        type: SYSTEM_EVENT_TYPES.TASK_SCHEDULE_TRIGGERED,
        severity: EventSeverity.INFO,
        message: `Scheduled task ${scheduledTask.name} queued a shell.exec run.`,
        metadata: {
          scheduleId: scheduledTask.id,
          scheduleName: scheduledTask.name,
          taskIds: createdTaskIds,
          timezone: scheduledTask.timezone,
          nextRunAt: nextRunAt.toISOString(),
          targetTeamId: scheduledTask.targetTeamId,
        },
      });

      return { ok: true };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown schedule error';

      this.logger.warn(
        `Scheduled task ${scheduledTask.id} failed to queue task: ${message}`,
      );

      await this.scheduledTasksRepository.update(
        {
          id: scheduledTask.id,
          claimToken: scheduledTask.claimToken,
        },
        {
          lastError: message,
          claimToken: null,
          claimedBy: null,
          leaseUntil: null,
        },
      );

      await this.eventsService.record({
        workspaceId: scheduledTask.workspaceId,
        nodeId: scheduledTask.nodeId,
        type: SYSTEM_EVENT_TYPES.TASK_SCHEDULE_FAILED,
        severity: EventSeverity.WARNING,
        message: `Scheduled task ${scheduledTask.name} failed to queue a run: ${message}`,
        metadata: {
          scheduleId: scheduledTask.id,
          scheduleName: scheduledTask.name,
          error: message,
          targetTeamId: scheduledTask.targetTeamId,
        },
      });

      return {
        ok: false,
        error: message,
      };
    }
  }

  private async populateScheduleMetadata(
    schedules: ScheduledTaskEntity[],
  ): Promise<ScheduledTaskEntity[]> {
    const ownerIds = Array.from(
      new Set(
        schedules
          .map((schedule) => schedule.ownerUserId)
          .filter((value): value is string => Boolean(value)),
      ),
    );

    const owners =
      ownerIds.length > 0
        ? ((await this.usersRepository.find({
            where: {
              id: In(ownerIds),
            },
          })) ?? [])
        : [];
    const ownerLookup = new Map(owners.map((owner) => [owner.id, owner]));

    return schedules.map((schedule) => {
      const owner = schedule.ownerUserId
        ? ownerLookup.get(schedule.ownerUserId)
        : null;
      schedule.ownerName = owner?.name ?? null;
      schedule.isLegacy = schedule.timezoneSource === 'legacy_fixed';
      return schedule;
    });
  }

  private normalizeScheduleInput(
    input: ScheduledTaskInputShape,
  ): NormalizedScheduleInput {
    const name = input.name.trim();
    const command = input.command.trim();

    if (name.length < 2) {
      throw new BadRequestException(
        'Schedule name must be at least 2 characters.',
      );
    }

    if (!command) {
      throw new BadRequestException('Command must not be empty.');
    }

    if (input.cadence === 'minutely') {
      if (
        input.hour !== undefined ||
        input.dayOfWeek !== undefined ||
        input.intervalMinutes !== undefined
      ) {
        throw new BadRequestException(
          'Minutely schedules do not accept hour, dayOfWeek, or intervalMinutes values.',
        );
      }

      return {
        name,
        command,
        runAsRoot: Boolean(input.runAsRoot),
        cadence: input.cadence,
        minute: 0,
        hour: null,
        dayOfWeek: null,
        intervalMinutes: null,
      };
    }

    if (input.cadence === 'custom') {
      if (input.intervalMinutes === undefined) {
        throw new BadRequestException(
          'Custom schedules require an intervalMinutes value.',
        );
      }

      if (input.hour !== undefined || input.dayOfWeek !== undefined) {
        throw new BadRequestException(
          'Custom schedules do not accept hour or dayOfWeek values.',
        );
      }

      return {
        name,
        command,
        runAsRoot: Boolean(input.runAsRoot),
        cadence: input.cadence,
        minute: 0,
        hour: null,
        dayOfWeek: null,
        intervalMinutes: input.intervalMinutes,
      };
    }

    if (input.cadence === 'hourly') {
      if (
        input.hour !== undefined ||
        input.dayOfWeek !== undefined ||
        input.intervalMinutes !== undefined
      ) {
        throw new BadRequestException(
          'Hourly schedules accept only the minute field.',
        );
      }

      return {
        name,
        command,
        runAsRoot: Boolean(input.runAsRoot),
        cadence: input.cadence,
        minute: input.minute,
        hour: null,
        dayOfWeek: null,
        intervalMinutes: null,
      };
    }

    if (input.cadence === 'daily') {
      if (input.hour === undefined) {
        throw new BadRequestException('Daily schedules require an hour value.');
      }
      if (
        input.dayOfWeek !== undefined ||
        input.intervalMinutes !== undefined
      ) {
        throw new BadRequestException(
          'Daily schedules do not accept dayOfWeek or intervalMinutes values.',
        );
      }

      return {
        name,
        command,
        runAsRoot: Boolean(input.runAsRoot),
        cadence: input.cadence,
        minute: input.minute,
        hour: input.hour,
        dayOfWeek: null,
        intervalMinutes: null,
      };
    }

    if (input.hour === undefined || input.dayOfWeek === undefined) {
      throw new BadRequestException(
        'Weekly schedules require both hour and dayOfWeek values.',
      );
    }

    if (input.intervalMinutes !== undefined) {
      throw new BadRequestException(
        'Weekly schedules do not accept an intervalMinutes value.',
      );
    }

    return {
      name,
      command,
      runAsRoot: Boolean(input.runAsRoot),
      cadence: input.cadence,
      minute: input.minute,
      hour: input.hour,
      dayOfWeek: input.dayOfWeek,
      intervalMinutes: null,
    };
  }

  private async findOwnerOrFail(ownerUserId: string): Promise<UserEntity> {
    const owner = await this.usersRepository.findOne({
      where: { id: ownerUserId },
    });

    if (!owner) {
      throw new NotFoundException(`User ${ownerUserId} was not found`);
    }

    return owner;
  }

  private async createSchedulesForNodes(
    owner: UserEntity,
    workspace: Awaited<ReturnType<WorkspacesService['findWorkspaceOrFail']>>,
    rawNodeIds: string[],
    normalized: NormalizedScheduleInput,
    templateId?: string,
    context?: RequestAuditContext,
  ): Promise<ScheduledTaskEntity[]> {
    const nodeIds = this.normalizeNodeIds(rawNodeIds);
    const template = templateId
      ? await this.resolveTemplateOrFail(templateId, workspace.id)
      : null;
    await Promise.all(
      nodeIds.map(async (nodeId) => {
        const node = await this.nodesService.ensureExists(nodeId, workspace.id);
        if (normalized.runAsRoot) {
          this.nodesService.assertNodeAllowsTaskRoot(node);
        }
      }),
    );

    const now = new Date();
    const nextRunAt = computeNextScheduledRun(
      {
        ...normalized,
        timezone: workspace.defaultTimezone,
      },
      now,
    );
    const schedules: ScheduledTaskEntity[] = [];

    for (const nodeId of nodeIds) {
      const scheduledTask = this.scheduledTasksRepository.create({
        workspaceId: workspace.id,
        nodeId,
        targetTeamId: null,
        templateId: template?.id ?? null,
        templateName: template?.name ?? null,
        ownerUserId: owner.id,
        name: normalized.name,
        command: normalized.command,
        runAsRoot: normalized.runAsRoot,
        cadence: normalized.cadence,
        minute: normalized.minute,
        hour: normalized.hour,
        dayOfWeek: normalized.dayOfWeek,
        intervalMinutes: normalized.intervalMinutes,
        timezone: workspace.defaultTimezone,
        timezoneSource: 'workspace',
        enabled: true,
        nextRunAt,
        lastRunAt: null,
        lastRunTaskId: null,
        lastError: null,
        leaseUntil: null,
        claimedBy: null,
        claimToken: null,
      });

      const saved = await this.scheduledTasksRepository.save(scheduledTask);
      saved.ownerName = owner.name;
      saved.isLegacy = false;

      await this.eventsService.record({
        nodeId: saved.nodeId,
        type: SYSTEM_EVENT_TYPES.TASK_SCHEDULE_CREATED,
        severity: EventSeverity.INFO,
        message: `Scheduled task ${saved.name} created. ${describeScheduledTask(saved)}`,
        metadata: {
          scheduleId: saved.id,
          scheduleName: saved.name,
          cadence: saved.cadence,
          ownerUserId: saved.ownerUserId,
          ownerName: owner.name,
          workspaceId: saved.workspaceId,
          timezone: saved.timezone,
          nextRunAt: saved.nextRunAt?.toISOString() ?? null,
          templateId: saved.templateId,
        },
      });

      await this.auditLogsService.record({
        scope: 'workspace',
        workspaceId: saved.workspaceId,
        action: 'task-schedule.created',
        targetType: 'scheduled-task',
        targetId: saved.id,
        targetLabel: saved.name,
        metadata: {
          nodeId: saved.nodeId,
          templateId: saved.templateId,
        },
        context,
      });

      schedules.push(saved);
    }

    return schedules;
  }

  private async createSchedulesForTeam(
    owner: UserEntity,
    workspace: Awaited<ReturnType<WorkspacesService['findWorkspaceOrFail']>>,
    teamId: string,
    normalized: NormalizedScheduleInput,
    templateId?: string,
    context?: RequestAuditContext,
  ): Promise<ScheduledTaskEntity[]> {
    const team = await this.workspacesService.findTeamOrFail(
      workspace.id,
      teamId,
    );
    if (normalized.runAsRoot) {
      const targetNodes = await this.nodesService.listTeamOwnedNodes(
        workspace.id,
        team.id,
      );
      targetNodes.forEach((node) =>
        this.nodesService.assertNodeAllowsTaskRoot(node),
      );
    }
    const template = templateId
      ? await this.resolveTemplateOrFail(templateId, workspace.id)
      : null;
    const nextRunAt = computeNextScheduledRun(
      {
        ...normalized,
        timezone: workspace.defaultTimezone,
      },
      new Date(),
    );
    const scheduledTask = this.scheduledTasksRepository.create({
      workspaceId: workspace.id,
      nodeId: null,
      targetTeamId: team.id,
      targetTeamName: team.name,
      templateId: template?.id ?? null,
      templateName: template?.name ?? null,
      ownerUserId: owner.id,
      name: normalized.name,
      command: normalized.command,
      runAsRoot: normalized.runAsRoot,
      cadence: normalized.cadence,
      minute: normalized.minute,
      hour: normalized.hour,
      dayOfWeek: normalized.dayOfWeek,
      intervalMinutes: normalized.intervalMinutes,
      timezone: workspace.defaultTimezone,
      timezoneSource: 'workspace',
      enabled: true,
      nextRunAt,
      lastRunAt: null,
      lastRunTaskId: null,
      lastError: null,
      leaseUntil: null,
      claimedBy: null,
      claimToken: null,
    });
    const saved = await this.scheduledTasksRepository.save(scheduledTask);
    saved.ownerName = owner.name;
    saved.isLegacy = false;

    await this.eventsService.record({
      workspaceId: saved.workspaceId,
      nodeId: null,
      type: SYSTEM_EVENT_TYPES.TASK_SCHEDULE_CREATED,
      severity: EventSeverity.INFO,
      message: `Scheduled task ${saved.name} created for team ${team.name}. ${describeScheduledTask(saved)}`,
      metadata: {
        scheduleId: saved.id,
        scheduleName: saved.name,
        targetTeamId: team.id,
        targetTeamName: team.name,
        templateId: saved.templateId,
      },
    });

    await this.auditLogsService.record({
      scope: 'workspace',
      workspaceId: saved.workspaceId,
      action: 'task-schedule.team-created',
      targetType: 'scheduled-task',
      targetId: saved.id,
      targetLabel: saved.name,
      metadata: {
        teamId: team.id,
        teamName: team.name,
        templateId: saved.templateId,
      },
      context,
    });

    return [saved];
  }

  private normalizeNodeIds(nodeIds: string[]): string[] {
    const normalizedNodeIds = Array.from(
      new Set(nodeIds.map((nodeId) => nodeId.trim()).filter(Boolean)),
    );

    if (normalizedNodeIds.length === 0) {
      throw new BadRequestException('Select at least one node.');
    }

    return normalizedNodeIds;
  }

  private async resolveWorkspace(
    workspaceId: string | undefined,
    owner: UserEntity,
  ) {
    if (workspaceId) {
      return this.workspacesService.assertWorkspaceWritable(workspaceId);
    }

    const defaultWorkspace =
      await this.workspacesService.getDefaultWorkspaceOrFail();
    await this.workspacesService.assertWorkspaceWritable(defaultWorkspace.id);

    if (owner.role === UserRole.PLATFORM_ADMIN) {
      return defaultWorkspace;
    }

    const membership = await this.workspacesService.findMembershipForUser(
      defaultWorkspace.id,
      owner.id,
    );

    if (!membership) {
      throw new NotFoundException(
        `User ${owner.id} is not a member of the default workspace.`,
      );
    }

    return defaultWorkspace;
  }

  private async resolveTemplateOrFail(
    templateId: string,
    workspaceId: string,
  ): Promise<TaskTemplateEntity> {
    const template = await this.taskTemplatesRepository.findOne({
      where: { id: templateId, workspaceId },
    });

    if (!template) {
      throw new NotFoundException(`Task template ${templateId} was not found`);
    }

    return template;
  }
}

type ScheduledTaskInputShape =
  | Pick<
      CreateScheduledTaskDto,
      | 'name'
      | 'command'
      | 'cadence'
      | 'minute'
      | 'hour'
      | 'dayOfWeek'
      | 'intervalMinutes'
      | 'runAsRoot'
    >
  | Pick<
      CreateBatchScheduledTaskDto,
      | 'name'
      | 'command'
      | 'cadence'
      | 'minute'
      | 'hour'
      | 'dayOfWeek'
      | 'intervalMinutes'
      | 'runAsRoot'
    >;

type NormalizedScheduleInput = {
  name: string;
  command: string;
  runAsRoot: boolean;
  cadence: ScheduledTaskEntity['cadence'];
  minute: number;
  hour: number | null;
  dayOfWeek: number | null;
  intervalMinutes: number | null;
};
