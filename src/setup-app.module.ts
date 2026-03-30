import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import configuration from './config/configuration';
import { normalizeDatabaseEnvAliases } from './config/database-env.utils';
import { LegacyHealthController } from './legacy-health.controller';
import { SetupModule } from './modules/setup/setup.module';

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
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class SetupAppModule {}
