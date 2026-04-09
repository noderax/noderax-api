import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import configuration from './config/configuration';
import { normalizeDatabaseEnvAliases } from './config/database-env.utils';
import { validationSchema } from './config/env.validation';
import { applyFileBackedEnv } from './config/file-backed-env.utils';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware';
import { getTypeOrmConfig } from './database/typeorm.config';
import { LegacyHealthController } from './legacy-health.controller';
import { AgentRealtimeModule } from './modules/agent-realtime/agent-realtime.module';
import { AgentUpdatesModule } from './modules/agent-updates/agent-updates.module';
import { AgentsModule } from './modules/agents/agents.module';
import { AuthModule } from './modules/auth/auth.module';
import { DiagnosticsModule } from './modules/diagnostics/diagnostics.module';
import { EnrollmentsModule } from './modules/enrollments/enrollments.module';
import { EventsModule } from './modules/events/events.module';
import { LogsModule } from './modules/logs/logs.module';
import { MetricsModule } from './modules/metrics/metrics.module';
import { NodesModule } from './modules/nodes/nodes.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OutboxModule } from './modules/outbox/outbox.module';
import { PackagesModule } from './modules/packages/packages.module';
import { PlatformSettingsModule } from './modules/platform-settings/platform-settings.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { TerminalSessionsModule } from './modules/terminal-sessions/terminal-sessions.module';
import { SetupModule } from './modules/setup/setup.module';
import { UsersModule } from './modules/users/users.module';
import { WorkspacesModule } from './modules/workspaces/workspaces.module';
import { RedisModule } from './redis/redis.module';
import { RuntimeModule } from './runtime/runtime.module';

applyFileBackedEnv();
normalizeDatabaseEnvAliases();

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
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
    RuntimeModule,
    OutboxModule,
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: getTypeOrmConfig,
    }),
    RedisModule,
    RealtimeModule,
    AgentRealtimeModule,
    AgentUpdatesModule,
    NotificationsModule,
    SetupModule,
    UsersModule,
    WorkspacesModule,
    AuthModule,
    DiagnosticsModule,
    EnrollmentsModule,
    NodesModule,
    PackagesModule,
    PlatformSettingsModule,
    EventsModule,
    LogsModule,
    MetricsModule,
    TasksModule,
    TerminalSessionsModule,
    AgentsModule,
  ],
  controllers: [AppController, LegacyHealthController],
  providers: [
    AppService,
    AllExceptionsFilter,
    LoggingInterceptor,
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
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
