import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware';
import configuration from './config/configuration';
import { normalizeDatabaseEnvAliases } from './config/database-env.utils';
import { LegacyHealthController } from './legacy-health.controller';
import { SetupModule } from './modules/setup/setup.module';
import { PrometheusMetricsService } from './runtime/prometheus-metrics.service';

normalizeDatabaseEnvAliases();

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: configuration,
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 100,
      },
    ]),
    SetupModule,
  ],
  controllers: [AppController, LegacyHealthController],
  providers: [
    AppService,
    PrometheusMetricsService,
    AllExceptionsFilter,
    LoggingInterceptor,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class SetupAppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
