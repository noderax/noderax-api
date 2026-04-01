import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { MailSettingsDto } from '../../common/dto/mail-settings.dto';
import { ValidateSmtpResponseDto } from '../../common/dto/validate-smtp-response.dto';
import { AuthenticatedUser } from '../../common/types/authenticated-user.type';
import {
  INSTALLER_MANAGED_FLAG,
  readInstallState,
  type InstallState,
  writeInstallState,
} from '../../install/install-state';
import { verifySmtpConnection } from '../../common/utils/smtp.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  PlatformApiRestartResponseDto,
  PlatformSettingsResponseDto,
  type PlatformSettingsValuesDto,
  UpdatePlatformSettingsDto,
} from './dto/platform-settings.dto';

const PLATFORM_SETTINGS_ENV_KEYS = [
  'CORS_ORIGIN',
  'SWAGGER_ENABLED',
  'SWAGGER_PATH',
  'DB_HOST',
  'DB_PORT',
  'DB_USERNAME',
  'DB_PASSWORD',
  'DB_NAME',
  'DB_SYNCHRONIZE',
  'DB_LOGGING',
  'DB_SSL',
  'REDIS_ENABLED',
  'REDIS_URL',
  'REDIS_HOST',
  'REDIS_PORT',
  'REDIS_PASSWORD',
  'REDIS_DB',
  'REDIS_KEY_PREFIX',
  'JWT_SECRET',
  'JWT_EXPIRES_IN',
  'BCRYPT_SALT_ROUNDS',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_SECURE',
  'SMTP_USERNAME',
  'SMTP_PASSWORD',
  'SMTP_FROM_EMAIL',
  'SMTP_FROM_NAME',
  'WEB_APP_URL',
  'AGENT_HEARTBEAT_TIMEOUT_SECONDS',
  'AGENT_OFFLINE_CHECK_INTERVAL_SECONDS',
  'AGENT_REALTIME_PING_TIMEOUT_SECONDS',
  'AGENT_REALTIME_PING_CHECK_INTERVAL_SECONDS',
  'AGENT_TASK_CLAIM_LEASE_SECONDS',
  'AGENT_STALE_TASK_CHECK_INTERVAL_SECONDS',
  'AGENT_STALE_QUEUED_TASK_TIMEOUT_SECONDS',
  'AGENT_STALE_RUNNING_TASK_TIMEOUT_SECONDS',
  'ENABLE_REALTIME_TASK_DISPATCH',
  'AGENT_ENROLLMENT_TOKEN',
  'AGENT_HIGH_CPU_THRESHOLD',
] as const;

type PlatformSettingsEnvKey = (typeof PLATFORM_SETTINGS_ENV_KEYS)[number];

@Injectable()
export class PlatformSettingsService {
  private readonly logger = new Logger(PlatformSettingsService.name);
  private restartScheduled = false;

  constructor(private readonly auditLogsService: AuditLogsService) {}

  getSettings(): PlatformSettingsResponseDto {
    return this.buildResponse();
  }

  updateSettings(
    dto: UpdatePlatformSettingsDto,
    actor?: AuthenticatedUser,
  ): PlatformSettingsResponseDto {
    const editable = this.isEditableDeployment();

    if (!editable) {
      throw new ConflictException(
        'Platform settings can only be updated for installer-managed deployments.',
      );
    }

    const installState =
      readInstallState() ??
      ({
        version: 1,
        source: 'installer',
        installedAt: new Date().toISOString(),
        runtimeEnv: {},
      } satisfies InstallState);

    const currentEnv = this.readCurrentRuntimeEnv();
    const nextEnv = {
      ...currentEnv,
      ...installState.runtimeEnv,
      ...this.serializeSettings(dto),
      [INSTALLER_MANAGED_FLAG]: 'true',
    };

    const previousSettings = this.mapEnvToSettings(currentEnv);

    writeInstallState({
      ...installState,
      runtimeEnv: nextEnv,
    });

    if (actor) {
      void this.auditLogsService.record({
        scope: 'platform',
        action: 'platform.settings.updated',
        targetType: 'platform_settings',
        targetLabel: 'runtime-env',
        changes: {
          before: previousSettings,
          after: dto,
        },
        context: {
          actorType: 'user',
          actorUserId: actor.id,
          actorEmailSnapshot: actor.email,
        },
      });
    }

    return this.buildResponse({
      env: nextEnv,
      source: 'install_state',
      editable: true,
    });
  }

  async validateSmtp(dto: MailSettingsDto): Promise<ValidateSmtpResponseDto> {
    try {
      await verifySmtpConnection({
        smtpHost: dto.smtpHost,
        smtpPort: dto.smtpPort,
        smtpSecure: dto.smtpSecure,
        smtpUsername: dto.smtpUsername,
        smtpPassword: dto.smtpPassword,
      });
    } catch (error) {
      throw new BadRequestException(
        `SMTP validation failed: ${(error as Error).message}`,
      );
    }

    return {
      success: true,
    };
  }

  createRestartResponse(): PlatformApiRestartResponseDto {
    return {
      accepted: true,
      requestedAt: new Date().toISOString(),
      message: this.restartScheduled
        ? 'API restart is already in progress. Wait for the process supervisor to bring the service back.'
        : 'API restart requested. The current process will exit and should come back if it is supervised by Docker, systemd, or another process manager.',
    };
  }

  scheduleApiRestart(actor?: AuthenticatedUser) {
    if (this.restartScheduled) {
      return;
    }

    this.restartScheduled = true;
    this.logger.warn('API restart requested. Exiting current process shortly.');

    if (actor) {
      void this.auditLogsService.record({
        scope: 'platform',
        action: 'platform.api.restart.requested',
        targetType: 'platform_settings',
        targetLabel: 'api-process',
        context: {
          actorType: 'user',
          actorUserId: actor.id,
          actorEmailSnapshot: actor.email,
        },
      });
    }

    const restartTimer = setTimeout(() => {
      try {
        process.kill(process.pid, 'SIGTERM');
      } catch (error) {
        this.logger.error(
          `Graceful shutdown signal failed: ${(error as Error).message}. Falling back to process.exit(0).`,
        );
        process.exit(0);
      }

      const forceExitTimer = setTimeout(() => {
        process.exit(0);
      }, 1_000);
      forceExitTimer.unref();
    }, 250);

    restartTimer.unref();
  }

  private buildResponse(input?: {
    env?: Record<string, string>;
    source?: 'install_state' | 'process_env';
    editable?: boolean;
    restartRequired?: boolean;
    message?: string | null;
  }): PlatformSettingsResponseDto {
    const installState = readInstallState();
    const env = input?.env ?? this.readCurrentRuntimeEnv();
    const source =
      input?.source ?? (installState ? 'install_state' : 'process_env');
    const editable = input?.editable ?? this.isEditableDeployment();
    const restartRequired =
      input?.restartRequired ?? (editable ? this.hasPendingRestart(env) : false);
    const settings = this.mapEnvToSettings(env);

    return {
      ...settings,
      source,
      editable,
      restartRequired,
      message:
        input?.message ??
        (editable
          ? restartRequired
            ? 'Saved settings are waiting for an API restart.'
            : 'Installer-managed settings are active.'
          : 'This deployment is using process environment values, so platform settings are read-only here.'),
    };
  }

  private isEditableDeployment() {
    return (
      process.env[INSTALLER_MANAGED_FLAG] === 'true' ||
      Boolean(readInstallState())
    );
  }

  private readCurrentRuntimeEnv(): Record<string, string> {
    const installState = readInstallState();
    const envFromProcess = Object.fromEntries(
      PLATFORM_SETTINGS_ENV_KEYS.map((key) => [key, process.env[key] ?? '']),
    ) as Record<PlatformSettingsEnvKey, string>;

    return {
      ...envFromProcess,
      ...(installState?.runtimeEnv ?? {}),
    };
  }

  private hasPendingRestart(expectedEnv: Record<string, string>) {
    return PLATFORM_SETTINGS_ENV_KEYS.some(
      (key) => (expectedEnv[key] ?? '') !== (process.env[key] ?? ''),
    );
  }

  private mapEnvToSettings(
    env: Record<string, string>,
  ): PlatformSettingsValuesDto {
    return {
      app: {
        corsOrigin: env.CORS_ORIGIN || '*',
        swaggerEnabled: this.parseBoolean(env.SWAGGER_ENABLED, true),
        swaggerPath: env.SWAGGER_PATH || 'docs',
      },
      database: {
        host: env.DB_HOST || '127.0.0.1',
        port: this.parseInteger(env.DB_PORT, 5432),
        username: env.DB_USERNAME || 'postgres',
        password: env.DB_PASSWORD || '',
        database: env.DB_NAME || 'noderax',
        synchronize: this.parseBoolean(env.DB_SYNCHRONIZE, false),
        logging: this.parseBoolean(env.DB_LOGGING, false),
        ssl: this.parseBoolean(env.DB_SSL, false),
      },
      redis: {
        enabled: this.parseBoolean(env.REDIS_ENABLED, true),
        url: env.REDIS_URL || '',
        host: env.REDIS_HOST || '127.0.0.1',
        port: this.parseInteger(env.REDIS_PORT, 6379),
        password: env.REDIS_PASSWORD || '',
        db: this.parseInteger(env.REDIS_DB, 0),
        keyPrefix: env.REDIS_KEY_PREFIX || 'noderax:',
      },
      auth: {
        jwtSecret: env.JWT_SECRET || 'noderax-local-secret',
        jwtExpiresIn: env.JWT_EXPIRES_IN || '1d',
        bcryptSaltRounds: this.parseInteger(env.BCRYPT_SALT_ROUNDS, 12),
      },
      mail: {
        smtpHost: env.SMTP_HOST || '',
        smtpPort: this.parseInteger(env.SMTP_PORT, 587),
        smtpSecure: this.parseBoolean(env.SMTP_SECURE, false),
        smtpUsername: env.SMTP_USERNAME || '',
        smtpPassword: env.SMTP_PASSWORD || '',
        fromEmail: env.SMTP_FROM_EMAIL || 'noreply@noderax.local',
        fromName: env.SMTP_FROM_NAME || 'Noderax',
        webAppUrl: env.WEB_APP_URL || 'http://localhost:3001',
      },
      agents: {
        heartbeatTimeoutSeconds: this.parseInteger(
          env.AGENT_HEARTBEAT_TIMEOUT_SECONDS,
          90,
        ),
        offlineCheckIntervalSeconds: this.parseInteger(
          env.AGENT_OFFLINE_CHECK_INTERVAL_SECONDS,
          90,
        ),
        realtimePingTimeoutSeconds: this.parseInteger(
          env.AGENT_REALTIME_PING_TIMEOUT_SECONDS,
          45,
        ),
        realtimePingCheckIntervalSeconds: this.parseInteger(
          env.AGENT_REALTIME_PING_CHECK_INTERVAL_SECONDS,
          5,
        ),
        taskClaimLeaseSeconds: this.parseInteger(
          env.AGENT_TASK_CLAIM_LEASE_SECONDS,
          60,
        ),
        staleTaskCheckIntervalSeconds: this.parseInteger(
          env.AGENT_STALE_TASK_CHECK_INTERVAL_SECONDS,
          15,
        ),
        staleQueuedTaskTimeoutSeconds: this.parseInteger(
          env.AGENT_STALE_QUEUED_TASK_TIMEOUT_SECONDS,
          120,
        ),
        staleRunningTaskTimeoutSeconds: this.parseInteger(
          env.AGENT_STALE_RUNNING_TASK_TIMEOUT_SECONDS,
          1800,
        ),
        enableRealtimeTaskDispatch: this.parseBoolean(
          env.ENABLE_REALTIME_TASK_DISPATCH,
          false,
        ),
        enrollmentToken: env.AGENT_ENROLLMENT_TOKEN || '',
        highCpuThreshold: this.parseNumber(env.AGENT_HIGH_CPU_THRESHOLD, 90),
      },
    };
  }

  private serializeSettings(
    settings: UpdatePlatformSettingsDto,
  ): Record<string, string> {
    return {
      CORS_ORIGIN: settings.app.corsOrigin,
      SWAGGER_ENABLED: String(settings.app.swaggerEnabled),
      SWAGGER_PATH: settings.app.swaggerPath,
      DB_HOST: settings.database.host,
      DB_PORT: String(settings.database.port),
      DB_USERNAME: settings.database.username,
      DB_PASSWORD: settings.database.password,
      DB_NAME: settings.database.database,
      DB_SYNCHRONIZE: String(settings.database.synchronize),
      DB_LOGGING: String(settings.database.logging),
      DB_SSL: String(settings.database.ssl),
      REDIS_ENABLED: String(settings.redis.enabled),
      REDIS_URL: settings.redis.url,
      REDIS_HOST: settings.redis.host,
      REDIS_PORT: String(settings.redis.port),
      REDIS_PASSWORD: settings.redis.password,
      REDIS_DB: String(settings.redis.db),
      REDIS_KEY_PREFIX: settings.redis.keyPrefix,
      JWT_SECRET: settings.auth.jwtSecret,
      JWT_EXPIRES_IN: settings.auth.jwtExpiresIn,
      BCRYPT_SALT_ROUNDS: String(settings.auth.bcryptSaltRounds),
      SMTP_HOST: settings.mail.smtpHost,
      SMTP_PORT: String(settings.mail.smtpPort),
      SMTP_SECURE: String(settings.mail.smtpSecure),
      SMTP_USERNAME: settings.mail.smtpUsername,
      SMTP_PASSWORD: settings.mail.smtpPassword,
      SMTP_FROM_EMAIL: settings.mail.fromEmail,
      SMTP_FROM_NAME: settings.mail.fromName,
      WEB_APP_URL: settings.mail.webAppUrl,
      AGENT_HEARTBEAT_TIMEOUT_SECONDS: String(
        settings.agents.heartbeatTimeoutSeconds,
      ),
      AGENT_OFFLINE_CHECK_INTERVAL_SECONDS: String(
        settings.agents.offlineCheckIntervalSeconds,
      ),
      AGENT_REALTIME_PING_TIMEOUT_SECONDS: String(
        settings.agents.realtimePingTimeoutSeconds,
      ),
      AGENT_REALTIME_PING_CHECK_INTERVAL_SECONDS: String(
        settings.agents.realtimePingCheckIntervalSeconds,
      ),
      AGENT_TASK_CLAIM_LEASE_SECONDS: String(
        settings.agents.taskClaimLeaseSeconds,
      ),
      AGENT_STALE_TASK_CHECK_INTERVAL_SECONDS: String(
        settings.agents.staleTaskCheckIntervalSeconds,
      ),
      AGENT_STALE_QUEUED_TASK_TIMEOUT_SECONDS: String(
        settings.agents.staleQueuedTaskTimeoutSeconds,
      ),
      AGENT_STALE_RUNNING_TASK_TIMEOUT_SECONDS: String(
        settings.agents.staleRunningTaskTimeoutSeconds,
      ),
      ENABLE_REALTIME_TASK_DISPATCH: String(
        settings.agents.enableRealtimeTaskDispatch,
      ),
      AGENT_ENROLLMENT_TOKEN: settings.agents.enrollmentToken,
      AGENT_HIGH_CPU_THRESHOLD: String(settings.agents.highCpuThreshold),
      [INSTALLER_MANAGED_FLAG]: 'true',
    };
  }

  private parseBoolean(value: string | undefined, fallback: boolean) {
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

  private parseInteger(value: string | undefined, fallback: number) {
    const parsed = Number.parseInt(value ?? '', 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private parseNumber(value: string | undefined, fallback: number) {
    const parsed = Number.parseFloat(value ?? '');
    return Number.isFinite(parsed) ? parsed : fallback;
  }
}
