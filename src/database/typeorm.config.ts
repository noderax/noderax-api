import { ConfigService, ConfigType } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { join } from 'path';
import { DATABASE_CONFIG_KEY, databaseConfig } from '../config';
import { buildPostgresSslOptions } from '../config/database-ssl.utils';
import { resolveTypeOrmLoggingOptions } from './typeorm-logging';

export function getTypeOrmConfig(
  configService: ConfigService,
): TypeOrmModuleOptions {
  const database =
    configService.getOrThrow<ConfigType<typeof databaseConfig>>(
      DATABASE_CONFIG_KEY,
    );

  return {
    type: 'postgres',
    host: database.host,
    port: database.port,
    username: database.username,
    password: database.password,
    database: database.name,
    autoLoadEntities: true,
    migrations: [join(__dirname, 'migrations/*{.ts,.js}')],
    synchronize: database.synchronize,
    logging: resolveTypeOrmLoggingOptions(
      process.env.NODE_ENV,
      database.logging,
    ),
    ssl: buildPostgresSslOptions({
      enabled: database.ssl,
      caFile: database.sslCaFile,
    }),
  };
}
