import {
  INestApplication,
  Logger,
  Module,
  RequestMethod,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigModule, ConfigService, ConfigType } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import * as compression from 'compression';
import helmet from 'helmet';
import { DataType, newDb } from 'pg-mem';
import { randomUUID } from 'crypto';
import { DataSource, DataSourceOptions } from 'typeorm';
import { AppController } from '../../src/app.controller';
import { AppService } from '../../src/app.service';
import { JwtAuthGuard } from '../../src/common/guards/jwt-auth.guard';
import { RolesGuard } from '../../src/common/guards/roles.guard';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { LoggingInterceptor } from '../../src/common/interceptors/logging.interceptor';
import configuration from '../../src/config/configuration';
import { normalizeDatabaseEnvAliases } from '../../src/config/database-env.utils';
import { validationSchema } from '../../src/config/env.validation';
import { APP_CONFIG_KEY, appConfig } from '../../src/config';
import { LegacyHealthController } from '../../src/legacy-health.controller';
import { AgentsModule } from '../../src/modules/agents/agents.module';
import { AuditLogEntity } from '../../src/modules/audit-logs/entities/audit-log.entity';
import { AuthModule } from '../../src/modules/auth/auth.module';
import { DiagnosticsModule } from '../../src/modules/diagnostics/diagnostics.module';
import { EnrollmentEntity } from '../../src/modules/enrollments/entities/enrollment.entity';
import { NodeInstallEntity } from '../../src/modules/enrollments/entities/node-install.entity';
import { EnrollmentsModule } from '../../src/modules/enrollments/enrollments.module';
import { EventsModule } from '../../src/modules/events/events.module';
import { EventEntity } from '../../src/modules/events/entities/event.entity';
import { MetricsModule } from '../../src/modules/metrics/metrics.module';
import { MetricEntity } from '../../src/modules/metrics/entities/metric.entity';
import { NodesModule } from '../../src/modules/nodes/nodes.module';
import { NodeEntity } from '../../src/modules/nodes/entities/node.entity';
import { NotificationsModule } from '../../src/modules/notifications/notifications.module';
import { PackagesModule } from '../../src/modules/packages/packages.module';
import { RealtimeModule } from '../../src/modules/realtime/realtime.module';
import { TaskLogEntity } from '../../src/modules/tasks/entities/task-log.entity';
import { ScheduledTaskEntity } from '../../src/modules/tasks/entities/scheduled-task.entity';
import { TaskEntity } from '../../src/modules/tasks/entities/task.entity';
import { TasksModule } from '../../src/modules/tasks/tasks.module';
import { TerminalSessionsModule } from '../../src/modules/terminal-sessions/terminal-sessions.module';
import { TerminalSessionChunkEntity } from '../../src/modules/terminal-sessions/entities/terminal-session-chunk.entity';
import { TerminalSessionEntity } from '../../src/modules/terminal-sessions/entities/terminal-session.entity';
import { PasswordResetTokenEntity } from '../../src/modules/users/entities/password-reset-token.entity';
import { UserInvitationEntity } from '../../src/modules/users/entities/user-invitation.entity';
import { UserEntity } from '../../src/modules/users/entities/user.entity';
import { UsersModule } from '../../src/modules/users/users.module';
import { TeamMembershipEntity } from '../../src/modules/workspaces/entities/team-membership.entity';
import { TeamEntity } from '../../src/modules/workspaces/entities/team.entity';
import { WorkspaceMembershipEntity } from '../../src/modules/workspaces/entities/workspace-membership.entity';
import { WorkspaceEntity } from '../../src/modules/workspaces/entities/workspace.entity';
import { WorkspacesModule } from '../../src/modules/workspaces/workspaces.module';
import { RedisModule } from '../../src/redis/redis.module';

const TEST_ENTITIES = [
  UserEntity,
  UserInvitationEntity,
  PasswordResetTokenEntity,
  EnrollmentEntity,
  NodeInstallEntity,
  NodeEntity,
  EventEntity,
  MetricEntity,
  TaskEntity,
  TaskLogEntity,
  ScheduledTaskEntity,
  TerminalSessionEntity,
  TerminalSessionChunkEntity,
  AuditLogEntity,
  WorkspaceEntity,
  WorkspaceMembershipEntity,
  TeamMembershipEntity,
  TeamEntity,
];

function createPgMemDataSource(
  options: DataSourceOptions,
): Promise<DataSource> {
  const db = newDb({
    autoCreateForeignKeyIndices: true,
  });

  const registerUuidFunctions = (schema: {
    registerFunction: (options: {
      name: string;
      returns: DataType;
      implementation: () => string;
      impure: boolean;
    }) => void;
  }) => {
    schema.registerFunction({
      name: 'gen_random_uuid',
      returns: DataType.uuid,
      implementation: () => randomUUID(),
      impure: true,
    });
    schema.registerFunction({
      name: 'uuid_generate_v4',
      returns: DataType.uuid,
      implementation: () => randomUUID(),
      impure: true,
    });
  };

  db.public.registerFunction({
    name: 'current_database',
    returns: DataType.text,
    implementation: () => 'noderax_e2e',
  });
  db.public.registerFunction({
    name: 'version',
    returns: DataType.text,
    implementation: () => 'PostgreSQL 16.0',
  });
  db.registerExtension('pgcrypto', registerUuidFunctions);
  db.registerExtension('uuid-ossp', registerUuidFunctions);

  const dataSource = db.adapters.createTypeormDataSource(options);
  return dataSource.initialize();
}

export async function createE2eApp(): Promise<INestApplication> {
  normalizeDatabaseEnvAliases();

  @Module({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        load: configuration,
        validationSchema,
      }),
      ThrottlerModule.forRoot([
        {
          ttl: 60000,
          limit: 100,
        },
      ]),
      ScheduleModule.forRoot(),
      TypeOrmModule.forRootAsync({
        useFactory: (): DataSourceOptions => ({
          type: 'postgres',
          entities: TEST_ENTITIES,
          synchronize: true,
          logging: false,
        }),
        dataSourceFactory: async (options) =>
          createPgMemDataSource(options as DataSourceOptions),
      }),
      RedisModule,
      RealtimeModule,
      NotificationsModule,
      UsersModule,
      AuthModule,
      DiagnosticsModule,
      WorkspacesModule,
      EnrollmentsModule,
      NodesModule,
      PackagesModule,
      EventsModule,
      MetricsModule,
      TasksModule,
      TerminalSessionsModule,
      AgentsModule,
    ],
    controllers: [AppController, LegacyHealthController],
    providers: [
      AppService,
      {
        provide: APP_GUARD,
        useClass: JwtAuthGuard,
      },
      {
        provide: APP_GUARD,
        useClass: RolesGuard,
      },
      {
        provide: APP_GUARD,
        useClass: ThrottlerGuard,
      },
    ],
  })
  class E2eTestAppModule {}

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [E2eTestAppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();
  app.use(helmet());
  app.use(compression());

  const configService = app.get(ConfigService);
  const appSettings =
    configService.getOrThrow<ConfigType<typeof appConfig>>(APP_CONFIG_KEY);

  if (appSettings.apiPrefix) {
    app.setGlobalPrefix(appSettings.apiPrefix, {
      exclude: [
        {
          path: 'health',
          method: RequestMethod.GET,
        },
        {
          path: `${appSettings.apiPrefix}/health`,
          method: RequestMethod.GET,
        },
      ],
    });
  }

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());
  app.enableShutdownHooks();

  await app.init();

  const logger = new Logger('E2eBootstrap');
  logger.log('E2E application started');

  return app;
}
