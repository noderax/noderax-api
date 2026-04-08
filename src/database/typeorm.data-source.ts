import 'reflect-metadata';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { APP_ENTITIES } from './app-entities';
import { normalizeDatabaseEnvAliases } from '../config/database-env.utils';
import { buildPostgresSslOptions } from '../config/database-ssl.utils';

normalizeDatabaseEnvAliases();

const isTrue = (value?: string | null) =>
  typeof value === 'string' &&
  ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());

export default new DataSource({
  type: 'postgres',
  host: process.env.DATABASE_HOST ?? process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DATABASE_PORT ?? process.env.DB_PORT ?? 5432),
  username:
    process.env.DATABASE_USERNAME ?? process.env.DB_USERNAME ?? 'postgres',
  password:
    process.env.DATABASE_PASSWORD ?? process.env.DB_PASSWORD ?? 'postgres',
  database: process.env.DATABASE_NAME ?? process.env.DB_NAME ?? 'noderax',
  entities: [...APP_ENTITIES],
  migrations: [join(__dirname, 'migrations/*{.ts,.js}')],
  synchronize: false,
  logging: isTrue(process.env.DATABASE_LOGGING ?? process.env.DB_LOGGING),
  ssl: buildPostgresSslOptions({
    enabled: isTrue(process.env.DATABASE_SSL ?? process.env.DB_SSL),
    caFile:
      process.env.DATABASE_SSL_CA_FILE ?? process.env.DB_SSL_CA_FILE ?? '',
  }),
});
