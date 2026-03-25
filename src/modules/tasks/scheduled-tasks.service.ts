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
import { EventSeverity } from '../events/entities/event-severity.enum';
import { EventsService } from '../events/events.service';
import { NodesService } from '../nodes/nodes.service';
import { UserEntity } from '../users/entities/user.entity';
import { CreateScheduledTaskDto } from './dto/create-scheduled-task.dto';
import { UpdateScheduledTaskDto } from './dto/update-scheduled-task.dto';
import { ScheduledTaskEntity } from './entities/scheduled-task.entity';
import {
  computeNextScheduledRun,
  describeScheduledTask,
  SCHEDULED_TASK_RUNNER_LEASE_MS,
  SCHEDULED_TASK_TIMEZONE,
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
    private readonly nodesService: NodesService,
    private readonly eventsService: EventsService,
    private readonly tasksService: TasksService,
  ) {}

  async create(
    ownerUserId: string,
    createScheduledTaskDto: CreateScheduledTaskDto,
  ): Promise<ScheduledTaskEntity> {
    await this.nodesService.ensureExists(createScheduledTaskDto.nodeId);
    const owner = await this.usersRepository.findOne({
      where: { id: ownerUserId },
    });

    if (!owner) {
      throw new NotFoundException(`User ${ownerUserId} was not found`);
    }

    const normalized = this.normalizeScheduleInput(createScheduledTaskDto);
    const scheduleTiming = {
      ...normalized,
      timezone: owner.timezone,
    };
    const nextRunAt = computeNextScheduledRun(scheduleTiming, new Date());

    const scheduledTask = this.scheduledTasksRepository.create({
      nodeId: createScheduledTaskDto.nodeId,
      ownerUserId: owner.id,
      name: normalized.name,
      command: normalized.command,
      cadence: normalized.cadence,
      minute: normalized.minute,
      hour: normalized.hour,
      dayOfWeek: normalized.dayOfWeek,
      timezone: owner.timezone,
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
        timezone: saved.timezone,
        nextRunAt: saved.nextRunAt?.toISOString() ?? null,
      },
    });

    return saved;
  }

  async findAll(): Promise<ScheduledTaskEntity[]> {
    const schedules = await this.scheduledTasksRepository
      .createQueryBuilder('schedule')
      .orderBy('schedule.enabled', 'DESC')
      .addOrderBy('schedule.nextRunAt', 'ASC', 'NULLS LAST')
      .addOrderBy('schedule.createdAt', 'ASC')
      .getMany();

    return this.populateOwnerMetadata(schedules);
  }

  async findOneOrFail(id: string): Promise<ScheduledTaskEntity> {
    const scheduledTask = await this.scheduledTasksRepository.findOne({
      where: { id },
    });

    if (!scheduledTask) {
      throw new NotFoundException(`Scheduled task ${id} was not found`);
    }

    const [decoratedSchedule] = await this.populateOwnerMetadata([
      scheduledTask,
    ]);
    return decoratedSchedule;
  }

  async updateEnabled(
    id: string,
    dto: UpdateScheduledTaskDto,
  ): Promise<ScheduledTaskEntity> {
    const scheduledTask = await this.findOneOrFail(id);
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
    saved.isLegacy =
      saved.ownerUserId === null && saved.timezone === SCHEDULED_TASK_TIMEZONE;

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
      },
    });

    return saved;
  }

  async delete(id: string): Promise<{ deleted: true; id: string }> {
    const scheduledTask = await this.findOneOrFail(id);
    await this.scheduledTasksRepository.remove(scheduledTask);

    await this.eventsService.record({
      nodeId: scheduledTask.nodeId,
      type: SYSTEM_EVENT_TYPES.TASK_SCHEDULE_DELETED,
      severity: EventSeverity.WARNING,
      message: `Scheduled task ${scheduledTask.name} deleted.`,
      metadata: {
        scheduleId: scheduledTask.id,
        scheduleName: scheduledTask.name,
      },
    });

    return {
      deleted: true,
      id,
    };
  }

  async syncSchedulesForOwnerTimezoneChange(
    ownerUserId: string,
    timezone: string,
  ): Promise<number> {
    const schedules = await this.scheduledTasksRepository.find({
      where: { ownerUserId },
      order: { createdAt: 'ASC' },
    });

    if (schedules.length === 0) {
      return 0;
    }

    const now = new Date();
    for (const schedule of schedules) {
      schedule.timezone = timezone;
      schedule.claimToken = null;
      schedule.claimedBy = null;
      schedule.leaseUntil = null;
      schedule.nextRunAt = schedule.enabled
        ? computeNextScheduledRun(schedule, now)
        : null;
    }

    await this.scheduledTasksRepository.save(schedules);
    return schedules.length;
  }

  async claimNextDueSchedule(
    claimedBy: string,
  ): Promise<ScheduledTaskEntity | null> {
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + SCHEDULED_TASK_RUNNER_LEASE_MS);
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
      .where(
        `id = (
          SELECT s.id
          FROM scheduled_tasks s
          WHERE s.enabled = true
            AND s."nextRunAt" IS NOT NULL
            AND s."nextRunAt" <= :now
            AND (
              s."leaseUntil" IS NULL
              OR s."leaseUntil" <= :now
            )
          ORDER BY s."nextRunAt" ASC, s."createdAt" ASC
          LIMIT 1
        )`,
      )
      .setParameters({ now })
      .returning('*')
      .execute();

    if ((updateResult.affected ?? 0) === 0) {
      return null;
    }

    const row = updateResult.raw?.[0] as ScheduledTaskEntity | undefined;
    if (row?.id) {
      return row;
    }

    return this.scheduledTasksRepository.findOne({
      where: { claimToken },
    });
  }

  async triggerClaimedSchedule(
    scheduledTask: ScheduledTaskEntity,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      const createdTask = await this.tasksService.createScheduledShellTask({
        nodeId: scheduledTask.nodeId,
        scheduleId: scheduledTask.id,
        scheduleName: scheduledTask.name,
        command: scheduledTask.command,
      });

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
          lastRunTaskId: createdTask.id,
          lastError: null,
          nextRunAt,
          claimToken: null,
          claimedBy: null,
          leaseUntil: null,
        },
      );

      await this.eventsService.record({
        nodeId: scheduledTask.nodeId,
        type: SYSTEM_EVENT_TYPES.TASK_SCHEDULE_TRIGGERED,
        severity: EventSeverity.INFO,
        message: `Scheduled task ${scheduledTask.name} queued a shell.exec run.`,
        metadata: {
          scheduleId: scheduledTask.id,
          scheduleName: scheduledTask.name,
          taskId: createdTask.id,
          timezone: scheduledTask.timezone,
          nextRunAt: nextRunAt.toISOString(),
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
        nodeId: scheduledTask.nodeId,
        type: SYSTEM_EVENT_TYPES.TASK_SCHEDULE_FAILED,
        severity: EventSeverity.WARNING,
        message: `Scheduled task ${scheduledTask.name} failed to queue a run: ${message}`,
        metadata: {
          scheduleId: scheduledTask.id,
          scheduleName: scheduledTask.name,
          error: message,
        },
      });

      return {
        ok: false,
        error: message,
      };
    }
  }

  private async populateOwnerMetadata(
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
      schedule.isLegacy =
        schedule.ownerUserId === null &&
        schedule.timezone === SCHEDULED_TASK_TIMEZONE;
      return schedule;
    });
  }

  private normalizeScheduleInput(input: CreateScheduledTaskDto): {
    name: string;
    command: string;
    cadence: ScheduledTaskEntity['cadence'];
    minute: number;
    hour: number | null;
    dayOfWeek: number | null;
  } {
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

    if (input.cadence === 'hourly') {
      if (input.hour !== undefined || input.dayOfWeek !== undefined) {
        throw new BadRequestException(
          'Hourly schedules accept only the minute field.',
        );
      }

      return {
        name,
        command,
        cadence: input.cadence,
        minute: input.minute,
        hour: null,
        dayOfWeek: null,
      };
    }

    if (input.cadence === 'daily') {
      if (input.hour === undefined) {
        throw new BadRequestException('Daily schedules require an hour value.');
      }
      if (input.dayOfWeek !== undefined) {
        throw new BadRequestException(
          'Daily schedules do not accept a dayOfWeek value.',
        );
      }

      return {
        name,
        command,
        cadence: input.cadence,
        minute: input.minute,
        hour: input.hour,
        dayOfWeek: null,
      };
    }

    if (input.hour === undefined || input.dayOfWeek === undefined) {
      throw new BadRequestException(
        'Weekly schedules require both hour and dayOfWeek values.',
      );
    }

    return {
      name,
      command,
      cadence: input.cadence,
      minute: input.minute,
      hour: input.hour,
      dayOfWeek: input.dayOfWeek,
    };
  }
}
