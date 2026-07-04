import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { AuthenticatedUser } from '../../common/types/authenticated-user.type';
import {
  isInstallerManagedDeployment,
  readInstallState,
  readManagedInstallEnv,
  writeInstallState,
  type InstallState,
} from '../../install/install-state';
import { ClusterLockService } from '../../runtime/cluster-lock.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  MetricsRetentionRunResponseDto,
  MetricsRetentionSettingsDto,
  UpdateMetricsRetentionDto,
} from './dto/metrics-retention.dto';
import { MetricsService } from './metrics.service';

const RETENTION_ENABLED_ENV_KEY = 'METRICS_RETENTION_ENABLED';
const RETENTION_DAYS_ENV_KEY = 'METRICS_RETENTION_DAYS';
const RETENTION_CHECK_INTERVAL_ENV_KEY =
  'METRICS_RETENTION_CHECK_INTERVAL_SECONDS';

const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_CHECK_INTERVAL_SECONDS = 3600;
const MIN_RETENTION_DAYS = 1;
const MAX_RETENTION_DAYS = 3650;

@Injectable()
export class MetricsRetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MetricsRetentionService.name);
  private readonly intervalName = 'metrics-retention';
  private readonly lockName = 'metrics-retention';
  private isRunning = false;
  private hasLoggedMissingMetricsTable = false;
  private lastRunAt: string | null = null;
  private lastDeletedCount: number | null = null;

  constructor(
    private readonly metricsService: MetricsService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly dataSource: DataSource,
    private readonly clusterLockService: ClusterLockService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  onModuleInit(): void {
    const intervalSeconds = this.resolveCheckIntervalSeconds();
    const interval = setInterval(() => {
      void this.runScheduledRetention();
    }, intervalSeconds * 1000);

    this.schedulerRegistry.addInterval(this.intervalName, interval);
    this.logger.log(
      `Scheduled metrics retention cleanup every ${intervalSeconds} seconds`,
    );

    void this.runScheduledRetention();
  }

  onModuleDestroy(): void {
    if (!this.schedulerRegistry.doesExist('interval', this.intervalName)) {
      return;
    }

    this.schedulerRegistry.deleteInterval(this.intervalName);
  }

  getSettings(): MetricsRetentionSettingsDto {
    const env = this.readRetentionEnv();

    return {
      enabled: this.parseBoolean(env[RETENTION_ENABLED_ENV_KEY], false),
      retentionDays: this.parseRetentionDays(env[RETENTION_DAYS_ENV_KEY]),
      editable: isInstallerManagedDeployment(),
      lastRunAt: this.lastRunAt,
      lastDeletedCount: this.lastDeletedCount,
    };
  }

  updateSettings(
    dto: UpdateMetricsRetentionDto,
    actor?: AuthenticatedUser,
  ): MetricsRetentionSettingsDto {
    if (!isInstallerManagedDeployment()) {
      throw new ConflictException(
        'Metrics retention can only be updated for installer-managed deployments.',
      );
    }

    const previous = this.getSettings();

    const installState =
      readInstallState() ??
      ({
        version: 2,
        source: 'installer',
        installedAt: new Date().toISOString(),
        managedEnv: {},
      } satisfies InstallState);

    const retentionDays = this.clampRetentionDays(dto.retentionDays);
    const enabledValue = String(dto.enabled);
    const daysValue = String(retentionDays);

    writeInstallState({
      ...installState,
      managedEnv: {
        ...readManagedInstallEnv(installState),
        [RETENTION_ENABLED_ENV_KEY]: enabledValue,
        [RETENTION_DAYS_ENV_KEY]: daysValue,
      },
    });

    // Keep process.env in sync so the change applies live without a restart.
    process.env[RETENTION_ENABLED_ENV_KEY] = enabledValue;
    process.env[RETENTION_DAYS_ENV_KEY] = daysValue;

    if (actor) {
      void this.auditLogsService.record({
        scope: 'platform',
        action: 'metrics.retention.updated',
        targetType: 'metrics_retention',
        targetLabel: 'metrics',
        changes: {
          before: {
            enabled: previous.enabled,
            retentionDays: previous.retentionDays,
          },
          after: { enabled: dto.enabled, retentionDays },
        },
        context: {
          actorType: 'user',
          actorUserId: actor.id,
          actorEmailSnapshot: actor.email,
        },
      });
    }

    return this.getSettings();
  }

  async runCleanupNow(
    actor?: AuthenticatedUser,
  ): Promise<MetricsRetentionRunResponseDto> {
    const { retentionDays } = this.getSettings();
    const deletedCount = await this.deleteWithLock(retentionDays);
    const runAt = this.lastRunAt ?? new Date().toISOString();

    if (actor) {
      void this.auditLogsService.record({
        scope: 'platform',
        action: 'metrics.retention.run',
        targetType: 'metrics_retention',
        targetLabel: 'metrics',
        metadata: { retentionDays, deletedCount },
        context: {
          actorType: 'user',
          actorUserId: actor.id,
          actorEmailSnapshot: actor.email,
        },
      });
    }

    return { deletedCount, runAt };
  }

  private async runScheduledRetention(): Promise<void> {
    if (this.isRunning) {
      this.logger.debug(
        'Skipping metrics retention because the previous run is still in progress',
      );
      return;
    }

    this.isRunning = true;

    try {
      if (!(await this.hasTable('metrics'))) {
        if (!this.hasLoggedMissingMetricsTable) {
          this.logger.warn(
            'Skipping metrics retention because the "metrics" table does not exist',
          );
          this.hasLoggedMissingMetricsTable = true;
        }

        return;
      }

      this.hasLoggedMissingMetricsTable = false;

      const settings = this.getSettings();
      if (!settings.enabled) {
        return;
      }

      await this.deleteWithLock(settings.retentionDays);
    } catch (error) {
      const message =
        error instanceof Error ? (error.stack ?? error.message) : String(error);
      this.logger.error('Metrics retention cleanup failed', message);
    } finally {
      this.isRunning = false;
    }
  }

  private async deleteWithLock(retentionDays: number): Promise<number> {
    const run = await this.clusterLockService.runWithLock(this.lockName, () =>
      this.metricsService.deleteMetricsOlderThan(retentionDays),
    );

    if (!run.acquired) {
      this.logger.debug(
        'Skipping metrics retention because another API instance currently owns the cluster lock',
      );
      return 0;
    }

    const deletedCount = run.result ?? 0;
    this.lastRunAt = new Date().toISOString();
    this.lastDeletedCount = deletedCount;

    if (deletedCount > 0) {
      this.logger.log(
        `Deleted ${deletedCount} metric row(s) older than ${retentionDays} day(s)`,
      );
    }

    return deletedCount;
  }

  private async hasTable(tableName: string): Promise<boolean> {
    const result = (await this.dataSource.query(
      `
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name = $1
        ) AS "exists"
      `,
      [tableName],
    )) as Array<{ exists: boolean }>;

    return Boolean(result[0]?.exists);
  }

  private readRetentionEnv(): Record<string, string | undefined> {
    const installState = readInstallState();
    const managedEnv = installState
      ? readManagedInstallEnv(installState)
      : {};

    return {
      [RETENTION_ENABLED_ENV_KEY]:
        managedEnv[RETENTION_ENABLED_ENV_KEY] ??
        process.env[RETENTION_ENABLED_ENV_KEY],
      [RETENTION_DAYS_ENV_KEY]:
        managedEnv[RETENTION_DAYS_ENV_KEY] ??
        process.env[RETENTION_DAYS_ENV_KEY],
    };
  }

  private resolveCheckIntervalSeconds(): number {
    const parsed = Number.parseInt(
      process.env[RETENTION_CHECK_INTERVAL_ENV_KEY] ?? '',
      10,
    );
    return Number.isFinite(parsed) && parsed > 0
      ? parsed
      : DEFAULT_CHECK_INTERVAL_SECONDS;
  }

  private parseRetentionDays(value: string | undefined): number {
    const parsed = Number.parseInt(value ?? '', 10);
    return Number.isFinite(parsed)
      ? this.clampRetentionDays(parsed)
      : DEFAULT_RETENTION_DAYS;
  }

  private clampRetentionDays(value: number): number {
    return Math.min(Math.max(Math.trunc(value), MIN_RETENTION_DAYS), MAX_RETENTION_DAYS);
  }

  private parseBoolean(value: string | undefined, fallback: boolean): boolean {
    if (typeof value !== 'string') {
      return fallback;
    }

    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) {
      return true;
    }
    if (['0', 'false', 'no', 'off'].includes(normalized)) {
      return false;
    }

    return fallback;
  }
}
