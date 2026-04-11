import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { readFileSync } from 'fs';
import Redis from 'ioredis';
import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { APP_ENTITIES } from '../../database/app-entities';
import {
  BOOT_MODE_ENV,
  clearInstallTransitionState,
  ensureInstallStateWritable,
  getInstallStateHealth,
  hasInstallState,
  INSTALLER_MANAGED_FLAG,
  readInstallTransitionState,
  splitInstallerEnv,
  writeInstallState,
  writeInstallSecrets,
  writeInstallTransitionState,
} from '../../install/install-state';
import { assertValidTimeZone } from '../../common/utils/timezone.util';
import { MailSettingsDto } from '../../common/dto/mail-settings.dto';
import { ValidateSmtpResponseDto } from '../../common/dto/validate-smtp-response.dto';
import { verifySmtpConnection } from '../../common/utils/smtp.util';
import { buildPostgresSslOptions } from '../../config/database-ssl.utils';
import { UserRole } from '../users/entities/user-role.enum';
import { UserEntity } from '../users/entities/user.entity';
import { UserInvitationStatus } from '../users/entities/user-invitation.entity';
import { WorkspaceMembershipRole } from '../workspaces/entities/workspace-membership-role.enum';
import { WorkspaceEntity } from '../workspaces/entities/workspace.entity';
import { WorkspaceMembershipEntity } from '../workspaces/entities/workspace-membership.entity';
import { join } from 'path';
import { InstallSetupDto } from './dto/install-setup.dto';
import { RuntimePresetResponseDto } from './dto/runtime-preset-response.dto';
import { SetupStatusResponseDto } from './dto/setup-status-response.dto';
import { ValidatePostgresConnectionDto } from './dto/validate-postgres-connection.dto';
import { ValidatePostgresResponseDto } from './dto/validate-postgres-response.dto';
import { ValidateRedisConnectionDto } from './dto/validate-redis-connection.dto';
import { ValidateRedisResponseDto } from './dto/validate-redis-response.dto';

const DEFAULT_BCRYPT_SALT_ROUNDS = 12;

@Injectable()
export class SetupService {
  private readonly logger = new Logger(SetupService.name);

  getStatus(): SetupStatusResponseDto {
    const stateDirectory = getInstallStateHealth();
    const transition = readInstallTransitionState();
    if (transition?.status === 'promoting') {
      return {
        mode: 'promoting',
        installed: false,
        restartRequired: false,
        stateDirectory,
      };
    }

    const bootMode = process.env[BOOT_MODE_ENV] as
      | 'setup'
      | 'installed'
      | 'legacy'
      | undefined;

    switch (bootMode) {
      case 'installed':
        return {
          mode: 'installed',
          installed: true,
          restartRequired: false,
          stateDirectory,
        };
      case 'legacy':
        return {
          mode: 'legacy',
          installed: true,
          restartRequired: false,
          stateDirectory,
        };
      default:
        return {
          mode: 'setup',
          installed: false,
          restartRequired: false,
          stateDirectory,
        };
    }
  }

  getRuntimePreset(): RuntimePresetResponseDto {
    const publicOrigin =
      process.env.NODERAX_PUBLIC_ORIGIN?.trim() ||
      process.env.WEB_APP_URL?.trim() ||
      null;
    const databasePassword = this.readEnvOrFile(
      'DATABASE_PASSWORD',
      'DATABASE_PASSWORD_FILE',
      this.readEnvOrFile('DB_PASSWORD', 'DB_PASSWORD_FILE', ''),
    );
    const redisPassword = this.readEnvOrFile(
      'REDIS_PASSWORD',
      'REDIS_PASSWORD_FILE',
      '',
    );

    return {
      mode:
        process.env.NODERAX_INSTALLER_PRESET_MODE === 'manual'
          ? 'manual'
          : 'local_bundle',
      publicOrigin,
      postgresPreset: {
        host: process.env.DATABASE_HOST ?? process.env.DB_HOST ?? 'postgres',
        port: Number(process.env.DATABASE_PORT ?? process.env.DB_PORT ?? 5432),
        username:
          process.env.DATABASE_USERNAME ??
          process.env.DB_USERNAME ??
          'postgres',
        password: databasePassword,
        database: process.env.DATABASE_NAME ?? process.env.DB_NAME ?? 'noderax',
        ssl:
          process.env.DATABASE_SSL === 'true' || process.env.DB_SSL === 'true',
      },
      redisPreset: {
        host: process.env.REDIS_HOST ?? 'redis',
        port: Number(process.env.REDIS_PORT ?? 6379),
        db: Number(process.env.REDIS_DB ?? 0),
        password: redisPassword,
      },
      editableFields: {
        postgres: true,
        redis: true,
        mail: true,
        publicOrigin: false,
      },
    };
  }

  private readEnvOrFile(
    envKey: string,
    fileEnvKey: string,
    fallback: string,
  ): string {
    const directValue = process.env[envKey];
    if (typeof directValue === 'string' && directValue.length > 0) {
      return directValue;
    }

    const filePath = process.env[fileEnvKey];
    if (typeof filePath === 'string' && filePath.trim().length > 0) {
      try {
        return readFileSync(filePath, 'utf8').replace(/\r?\n$/, '');
      } catch {
        return fallback;
      }
    }

    return fallback;
  }

  async validatePostgres(
    dto: ValidatePostgresConnectionDto,
  ): Promise<ValidatePostgresResponseDto> {
    this.assertSetupOpen();

    return this.probePostgres(dto);
  }

  async validateRedis(
    dto: ValidateRedisConnectionDto,
  ): Promise<ValidateRedisResponseDto> {
    this.assertSetupOpen();

    await this.probeRedis(dto);

    return { success: true };
  }

  async validateSmtp(dto: MailSettingsDto): Promise<ValidateSmtpResponseDto> {
    this.assertSetupOpen();

    await this.probeSmtp(dto);

    return { success: true };
  }

  async install(dto: InstallSetupDto) {
    this.assertSetupOpen();

    const normalizedTimezone = assertValidTimeZone(
      dto.workspace.defaultTimezone,
    );
    if (!normalizedTimezone) {
      throw new BadRequestException('Workspace timezone is invalid.');
    }

    const postgresProbe = await this.probePostgres(dto.postgres);
    await this.probeRedis(dto.redis);

    try {
      ensureInstallStateWritable();
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }

    const recoverablePartialInstall = !postgresProbe.databaseEmpty
      ? await this.isRecoverablePartialInstall(dto.postgres)
      : false;

    if (!postgresProbe.databaseEmpty && !recoverablePartialInstall) {
      throw new ConflictException(
        'Database is not empty. Use manual migration for existing deployments.',
      );
    }

    let dataSource: DataSource | null = null;
    const postgresClient = this.createPostgresClient(dto.postgres);

    try {
      await postgresClient.connect();
      await postgresClient.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
      await postgresClient.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    } catch (error) {
      throw new BadRequestException(
        `PostgreSQL extension bootstrap failed: ${(error as Error).message}`,
      );
    } finally {
      await postgresClient.end().catch(() => undefined);
    }

    try {
      dataSource = new DataSource({
        type: 'postgres',
        host: dto.postgres.host,
        port: dto.postgres.port ?? 5432,
        username: dto.postgres.username,
        password: dto.postgres.password,
        database: dto.postgres.database,
        ssl: buildPostgresSslOptions({
          enabled: dto.postgres.ssl,
          caFile:
            process.env.DATABASE_SSL_CA_FILE ?? process.env.DB_SSL_CA_FILE,
        }),
        entities: [...APP_ENTITIES],
        migrations: [join(__dirname, '../../database/migrations/*{.ts,.js}')],
        synchronize: false,
        logging: false,
      });

      await dataSource.initialize();
      await dataSource.runMigrations();

      const usersRepository = dataSource.getRepository(UserEntity);
      const workspacesRepository = dataSource.getRepository(WorkspaceEntity);
      const membershipsRepository = dataSource.getRepository(
        WorkspaceMembershipEntity,
      );

      const passwordHash = await bcrypt.hash(
        dto.admin.password,
        DEFAULT_BCRYPT_SALT_ROUNDS,
      );

      const adminUser = await usersRepository.save(
        usersRepository.create({
          email: dto.admin.email.toLowerCase(),
          name: dto.admin.name.trim(),
          passwordHash,
          role: UserRole.PLATFORM_ADMIN,
          timezone: normalizedTimezone,
          isActive: true,
          inviteStatus: UserInvitationStatus.ACCEPTED,
          lastInvitedAt: null,
          activatedAt: new Date(),
          criticalEventEmailsEnabled: true,
          enrollmentEmailsEnabled: true,
          sessionVersion: 0,
        }),
      );

      const workspace = await workspacesRepository.save(
        workspacesRepository.create({
          name: dto.workspace.name.trim(),
          slug: dto.workspace.slug.trim().toLowerCase(),
          defaultTimezone: normalizedTimezone,
          createdByUserId: adminUser.id,
          isArchived: false,
          isDefault: true,
        }),
      );

      await membershipsRepository.save(
        membershipsRepository.create({
          workspaceId: workspace.id,
          userId: adminUser.id,
          role: WorkspaceMembershipRole.OWNER,
        }),
      );

      const installEnv = this.buildRuntimeEnv(dto);
      const { managedEnv, secretEnv } = splitInstallerEnv(installEnv);

      clearInstallTransitionState();
      writeInstallState({
        version: 2,
        source: 'installer',
        installedAt: new Date().toISOString(),
        managedEnv,
      });
      writeInstallSecrets(secretEnv);
      writeInstallTransitionState({
        status: 'promoting',
        target: 'runtime_ha',
        details: {
          publicOrigin: dto.mail.webAppUrl,
        },
      });

      this.logger.log('Initial installer completed successfully');

      return {
        success: true as const,
        restartRequired: false as const,
        setupComplete: true as const,
        transition: 'promoting_runtime' as const,
      };
    } finally {
      if (dataSource?.isInitialized) {
        await dataSource.destroy().catch(() => undefined);
      }
    }
  }

  private assertSetupOpen() {
    const status = this.getStatus();
    if (status.mode !== 'setup') {
      throw new ConflictException('Setup already completed.');
    }

    if (hasInstallState()) {
      throw new ConflictException('Setup already completed.');
    }
  }

  private async probePostgres(
    dto: ValidatePostgresConnectionDto,
  ): Promise<ValidatePostgresResponseDto> {
    const client = this.createPostgresClient(dto);

    try {
      await client.connect();
      const versionResult = await client.query<{ version: string }>(
        `SELECT version() AS version`,
      );
      const tablesResult = await client.query<{ count: string }>(
        `
          SELECT COUNT(*)::text AS count
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_type = 'BASE TABLE'
        `,
      );

      return {
        success: true,
        serverVersion: versionResult.rows[0]?.version ?? 'PostgreSQL',
        databaseEmpty: Number(tablesResult.rows[0]?.count ?? '0') === 0,
      };
    } catch (error) {
      throw new BadRequestException(
        `PostgreSQL connection failed: ${(error as Error).message}`,
      );
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  private createPostgresClient(dto: ValidatePostgresConnectionDto) {
    return new Client({
      host: dto.host,
      port: dto.port ?? 5432,
      user: dto.username,
      password: dto.password,
      database: dto.database,
      ssl: buildPostgresSslOptions({
        enabled: dto.ssl,
        caFile: process.env.DATABASE_SSL_CA_FILE ?? process.env.DB_SSL_CA_FILE,
      }),
    });
  }

  private async probeRedis(dto: ValidateRedisConnectionDto) {
    const client = new Redis({
      host: dto.host,
      port: dto.port ?? 6379,
      password: dto.password || undefined,
      db: dto.db ?? 0,
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
    });

    try {
      await client.connect();
      await client.ping();
    } catch (error) {
      throw new BadRequestException(
        `Redis connection failed: ${(error as Error).message}`,
      );
    } finally {
      if (client.status === 'ready') {
        await client.quit().catch(() => undefined);
      } else {
        client.disconnect(false);
      }
    }
  }

  private generateSecret() {
    return randomBytes(48).toString('base64url');
  }

  private buildRuntimeEnv(dto: InstallSetupDto): Record<string, string> {
    const secretsEncryptionKey =
      process.env.SECRETS_ENCRYPTION_KEY?.trim() || this.generateSecret();

    return {
      DATABASE_HOST: dto.postgres.host,
      DB_HOST: dto.postgres.host,
      DATABASE_PORT: String(dto.postgres.port ?? 5432),
      DB_PORT: String(dto.postgres.port ?? 5432),
      DATABASE_USERNAME: dto.postgres.username,
      DB_USERNAME: dto.postgres.username,
      DATABASE_PASSWORD: dto.postgres.password,
      DB_PASSWORD: dto.postgres.password,
      DATABASE_NAME: dto.postgres.database,
      DB_NAME: dto.postgres.database,
      DATABASE_SSL: dto.postgres.ssl ? 'true' : 'false',
      DB_SSL: dto.postgres.ssl ? 'true' : 'false',
      DATABASE_SYNCHRONIZE: 'false',
      DB_SYNCHRONIZE: 'false',
      DATABASE_LOGGING: 'false',
      DB_LOGGING: 'false',
      REDIS_ENABLED: 'true',
      REDIS_HOST: dto.redis.host,
      REDIS_PORT: String(dto.redis.port ?? 6379),
      REDIS_PASSWORD: dto.redis.password ?? '',
      REDIS_DB: String(dto.redis.db ?? 0),
      REDIS_URL: '',
      REDIS_KEY_PREFIX: process.env.REDIS_KEY_PREFIX ?? 'noderax:',
      SMTP_HOST: dto.mail.smtpHost,
      SMTP_PORT: String(dto.mail.smtpPort),
      SMTP_SECURE: dto.mail.smtpSecure ? 'true' : 'false',
      SMTP_USERNAME: dto.mail.smtpUsername,
      SMTP_PASSWORD: dto.mail.smtpPassword,
      SMTP_FROM_EMAIL: dto.mail.fromEmail,
      SMTP_FROM_NAME: dto.mail.fromName,
      WEB_APP_URL: dto.mail.webAppUrl,
      JWT_SECRET: this.generateSecret(),
      JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN ?? '1d',
      BCRYPT_SALT_ROUNDS:
        process.env.BCRYPT_SALT_ROUNDS ?? String(DEFAULT_BCRYPT_SALT_ROUNDS),
      SECRETS_ENCRYPTION_KEY: secretsEncryptionKey,
      AGENT_ENROLLMENT_TOKEN: this.generateSecret(),
      SEED_DEFAULT_ADMIN: 'false',
      [INSTALLER_MANAGED_FLAG]: 'true',
    };
  }

  private async isRecoverablePartialInstall(
    dto: ValidatePostgresConnectionDto,
  ): Promise<boolean> {
    const client = this.createPostgresClient(dto);

    try {
      await client.connect();

      const tablesResult = await client.query<{ table_name: string }>(
        `
          SELECT table_name
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name = ANY($1::text[])
        `,
        [['users', 'workspaces', 'workspace_memberships']],
      );

      const presentTables = new Set(
        tablesResult.rows.map((row) => row.table_name),
      );

      if (
        !presentTables.has('users') ||
        !presentTables.has('workspaces') ||
        !presentTables.has('workspace_memberships')
      ) {
        return false;
      }

      const result = await client.query<{
        userCount: string;
        workspaceCount: string;
        membershipCount: string;
        nodeCount: string;
        taskCount: string;
        scheduledTaskCount: string;
        eventCount: string;
        metricCount: string;
        enrollmentCount: string;
        nodeInstallCount: string;
        outboxCount: string;
      }>(`
        SELECT
          (SELECT COUNT(*)::text FROM "users") AS "userCount",
          (SELECT COUNT(*)::text FROM "workspaces") AS "workspaceCount",
          (SELECT COUNT(*)::text FROM "workspace_memberships") AS "membershipCount",
          (SELECT COUNT(*)::text FROM "nodes") AS "nodeCount",
          (SELECT COUNT(*)::text FROM "tasks") AS "taskCount",
          (SELECT COUNT(*)::text FROM "scheduled_tasks") AS "scheduledTaskCount",
          (SELECT COUNT(*)::text FROM "events") AS "eventCount",
          (SELECT COUNT(*)::text FROM "metrics") AS "metricCount",
          (SELECT COUNT(*)::text FROM "enrollments") AS "enrollmentCount",
          (SELECT COUNT(*)::text FROM "node_installs") AS "nodeInstallCount",
          (SELECT COUNT(*)::text FROM "outbox_events") AS "outboxCount"
      `);

      const snapshot = result.rows[0];

      if (!snapshot) {
        return false;
      }

      const runtimeCounts = [
        snapshot.userCount,
        snapshot.workspaceCount,
        snapshot.membershipCount,
        snapshot.nodeCount,
        snapshot.taskCount,
        snapshot.scheduledTaskCount,
        snapshot.eventCount,
        snapshot.metricCount,
        snapshot.enrollmentCount,
        snapshot.nodeInstallCount,
        snapshot.outboxCount,
      ].map((value) => Number(value ?? '0'));

      return runtimeCounts.every((count) => count === 0);
    } catch {
      return false;
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  private async probeSmtp(dto: MailSettingsDto) {
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
  }
}
