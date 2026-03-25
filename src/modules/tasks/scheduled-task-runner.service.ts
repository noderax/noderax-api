import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { hostname } from 'os';
import { randomUUID } from 'crypto';
import { SCHEDULED_TASK_RUNNER_INTERVAL_MS } from './scheduled-task.utils';
import { ScheduledTasksService } from './scheduled-tasks.service';

@Injectable()
export class ScheduledTaskRunnerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ScheduledTaskRunnerService.name);
  private readonly intervalName = 'scheduled-task-runner';
  private readonly instanceId = `${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;
  private isRunning = false;

  constructor(
    private readonly scheduledTasksService: ScheduledTasksService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    const interval = setInterval(() => {
      void this.runDueSchedules();
    }, SCHEDULED_TASK_RUNNER_INTERVAL_MS);

    this.schedulerRegistry.addInterval(this.intervalName, interval);
    this.logger.log(
      `Scheduled task runner checks due work every ${SCHEDULED_TASK_RUNNER_INTERVAL_MS}ms`,
    );

    void this.runDueSchedules();
  }

  onModuleDestroy(): void {
    if (!this.schedulerRegistry.doesExist('interval', this.intervalName)) {
      return;
    }

    this.schedulerRegistry.deleteInterval(this.intervalName);
  }

  private async runDueSchedules(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;

    try {
      while (true) {
        const scheduledTask =
          await this.scheduledTasksService.claimNextDueSchedule(
            this.instanceId,
          );

        if (!scheduledTask) {
          return;
        }

        const result =
          await this.scheduledTasksService.triggerClaimedSchedule(
            scheduledTask,
          );

        if (!result.ok) {
          return;
        }
      }
    } catch (error) {
      const message =
        error instanceof Error ? (error.stack ?? error.message) : String(error);
      this.logger.error('Scheduled task runner failed', message);
    } finally {
      this.isRunning = false;
    }
  }
}
