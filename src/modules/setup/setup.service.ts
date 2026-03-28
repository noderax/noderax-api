import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import Redis from 'ioredis';
import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { APP_ENTITIES } from '../../database/app-entities';
import {
  BOOT_MODE_ENV,
  ensureInstallStateWritable,
  getInstallStateHealth,
  hasInstallState,
  INSTALLER_MANAGED_FLAG,
  writeInstallState,
} from '../../install/install-state';
import { assertValidTimeZone } from '../../common/utils/timezone.util';
import { UserRole } from '../users/entities/user-role.enum';
import { UserEntity } from '../users/entities/user.entity';
import { UserInvitationStatus } from '../users/entities/user-invitation.entity';
import { EnrollmentSchemaBootstrap } from '../enrollments/bootstrap/enrollment-schema.bootstrap';
import { WorkspaceMembershipRole } from '../workspaces/entities/workspace-membership-role.enum';
import { WorkspaceEntity } from '../workspaces/entities/workspace.entity';
import { WorkspaceMembershipEntity } from '../workspaces/entities/workspace-membership.entity';
import { ScheduledTaskSchemaBootstrap } from '../tasks/bootstrap/scheduled-task-schema.bootstrap';
import { TaskSchemaBootstrap } from '../tasks/bootstrap/task-schema.bootstrap';
import { UserPreferencesSchemaBootstrap } from '../users/bootstrap/user-preferences-schema.bootstrap';
import { WorkspaceSchemaBootstrap } from '../workspaces/bootstrap/workspace-schema.bootstrap';
import { InstallSetupDto } from './dto/install-setup.dto';
import { SetupStatusResponseDto } from './dto/setup-status-response.dto';
import { ValidatePostgresConnectionDto } from './dto/validate-postgres-connection.dto';
import { ValidatePostgresResponseDto } from './dto/validate-postgres-response.dto';
import { ValidateRedisConnectionDto } from './dto/validate-redis-connection.dto';
import { ValidateRedisResponseDto } from './dto/validate-redis-response.dto';

const DEFAULT_BCRYPT_SALT_ROUNDS = 12;

@Injectable()
export class SetupService {
  private readonly logger = new Logger(SetupService.name);
  private restartRequired = false;

  getStatus(): SetupStatusResponseDto {
    const stateDirectory = getInstallStateHealth();

    if (this.restartRequired) {
      return {
        mode: 'restart_required',
        installed: false,
        restartRequired: true,
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

    if (recoverablePartialInstall) {
      writeInstallState({
        version: 1,
        source: 'installer',
        installedAt: new Date().toISOString(),
        runtimeEnv: this.buildRuntimeEnv(dto),
      });

      this.restartRequired = true;
      this.logger.log('Recovered installer state after a partial setup run');

      return {
        success: true as const,
        restartRequired: true as const,
      };
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
        ssl: dto.postgres.ssl ? { rejectUnauthorized: false } : false,
        entities: [...APP_ENTITIES],
        synchronize: true,
        logging: false,
      });

      await dataSource.initialize();

      await new EnrollmentSchemaBootstrap(dataSource).onModuleInit();
      await new UserPreferencesSchemaBootstrap(dataSource).onModuleInit();
      await new TaskSchemaBootstrap(dataSource).onModuleInit();
      await new ScheduledTaskSchemaBootstrap(dataSource).onModuleInit();
      await new WorkspaceSchemaBootstrap(dataSource).onModuleInit();

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

      writeInstallState({
        version: 1,
        source: 'installer',
        installedAt: new Date().toISOString(),
        runtimeEnv: this.buildRuntimeEnv(dto),
      });

      this.restartRequired = true;
      this.logger.log('Initial installer completed successfully');

      return {
        success: true as const,
        restartRequired: true as const,
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
      ssl: dto.ssl ? { rejectUnauthorized: false } : undefined,
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
    return {
      DB_HOST: dto.postgres.host,
      DB_PORT: String(dto.postgres.port ?? 5432),
      DB_USERNAME: dto.postgres.username,
      DB_PASSWORD: dto.postgres.password,
      DB_NAME: dto.postgres.database,
      DB_SSL: dto.postgres.ssl ? 'true' : 'false',
      DB_SYNCHRONIZE: 'false',
      DB_LOGGING: 'false',
      REDIS_ENABLED: 'true',
      REDIS_HOST: dto.redis.host,
      REDIS_PORT: String(dto.redis.port ?? 6379),
      REDIS_PASSWORD: dto.redis.password ?? '',
      REDIS_DB: String(dto.redis.db ?? 0),
      REDIS_URL: '',
      REDIS_KEY_PREFIX: process.env.REDIS_KEY_PREFIX ?? 'noderax:',
      JWT_SECRET: this.generateSecret(),
      JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN ?? '1d',
      BCRYPT_SALT_ROUNDS:
        process.env.BCRYPT_SALT_ROUNDS ?? String(DEFAULT_BCRYPT_SALT_ROUNDS),
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
        adminCount: string;
        workspaceCount: string;
        ownerMembershipCount: string;
        nodeCount: string;
        taskCount: string;
        scheduledTaskCount: string;
        eventCount: string;
        metricCount: string;
        enrollmentCount: string;
      }>(`
        SELECT
          (SELECT COUNT(*)::text FROM "users" WHERE "role"::text = 'platform_admin') AS "adminCount",
          (SELECT COUNT(*)::text FROM "workspaces") AS "workspaceCount",
          (SELECT COUNT(*)::text FROM "workspace_memberships" WHERE "role"::text = 'owner') AS "ownerMembershipCount",
          (SELECT COUNT(*)::text FROM "nodes") AS "nodeCount",
          (SELECT COUNT(*)::text FROM "tasks") AS "taskCount",
          (SELECT COUNT(*)::text FROM "scheduled_tasks") AS "scheduledTaskCount",
          (SELECT COUNT(*)::text FROM "events") AS "eventCount",
          (SELECT COUNT(*)::text FROM "metrics") AS "metricCount",
          (SELECT COUNT(*)::text FROM "enrollments") AS "enrollmentCount"
      `);

      const snapshot = result.rows[0];

      if (!snapshot) {
        return false;
      }

      const runtimeCounts = [
        snapshot.nodeCount,
        snapshot.taskCount,
        snapshot.scheduledTaskCount,
        snapshot.eventCount,
        snapshot.metricCount,
        snapshot.enrollmentCount,
      ].map((value) => Number(value ?? '0'));

      return (
        Number(snapshot.adminCount ?? '0') > 0 &&
        Number(snapshot.workspaceCount ?? '0') > 0 &&
        Number(snapshot.ownerMembershipCount ?? '0') > 0 &&
        runtimeCounts.every((count) => count === 0)
      );
    } catch {
      return false;
    } finally {
      await client.end().catch(() => undefined);
    }
  }
}
