import { ConfigService, ConfigType } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { DATABASE_CONFIG_KEY, databaseConfig } from '../config';
import { buildPostgresSslOptions } from '../config/database-ssl.utils';

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
    synchronize: database.synchronize,
    logging: database.logging,
    ssl: buildPostgresSslOptions({
      enabled: database.ssl,
      caFile: database.sslCaFile,
    }),
  };
}
