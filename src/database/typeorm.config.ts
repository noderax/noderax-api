import { ConfigService, ConfigType } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { databaseConfig } from '../config';

export function getTypeOrmConfig(
  configService: ConfigService,
): TypeOrmModuleOptions {
  const database = configService.getOrThrow<ConfigType<typeof databaseConfig>>(
    databaseConfig.KEY,
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
    ssl: database.ssl ? { rejectUnauthorized: false } : false,
  };
}
