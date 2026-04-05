import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import {
  INCIDENT_RULE_RUNNER_INTERVAL_MS,
  IncidentsService,
} from './incidents.service';

@Injectable()
export class LogMonitorRunnerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LogMonitorRunnerService.name);
  private readonly intervalName = 'log-monitor-runner';
  private isRunning = false;

  constructor(
    private readonly incidentsService: IncidentsService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    const interval = setInterval(() => {
      void this.runDueRules();
    }, INCIDENT_RULE_RUNNER_INTERVAL_MS);

    this.schedulerRegistry.addInterval(this.intervalName, interval);
    this.logger.log(
      `Log monitor runner checks due rules every ${INCIDENT_RULE_RUNNER_INTERVAL_MS}ms`,
    );

    void this.runDueRules();
  }

  onModuleDestroy(): void {
    if (!this.schedulerRegistry.doesExist('interval', this.intervalName)) {
      return;
    }

    this.schedulerRegistry.deleteInterval(this.intervalName);
  }

  private async runDueRules(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;

    try {
      while (true) {
        const rule = await this.incidentsService.claimNextDueRule(
          this.incidentsService.runnerInstanceId,
        );

        if (!rule) {
          return;
        }

        const result = await this.incidentsService.triggerClaimedRule(rule);
        if (!result.ok) {
          return;
        }
      }
    } catch (error) {
      this.logger.error(
        'Log monitor runner failed',
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      );
    } finally {
      this.isRunning = false;
    }
  }
}
