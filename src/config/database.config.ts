import { registerAs } from '@nestjs/config';
import { getDatabaseEnvValue } from './database-env.utils';

export const DATABASE_CONFIG_KEY = 'database';

export const databaseConfig = registerAs(DATABASE_CONFIG_KEY, () => ({
  host: getDatabaseEnvValue(
    process.env,
    'DATABASE_HOST',
    'DB_HOST',
    '127.0.0.1',
  ),
  port: parseInt(
    getDatabaseEnvValue(process.env, 'DATABASE_PORT', 'DB_PORT', '5432'),
    10,
  ),
  username: getDatabaseEnvValue(
    process.env,
    'DATABASE_USERNAME',
    'DB_USERNAME',
    'postgres',
  ),
  password: getDatabaseEnvValue(
    process.env,
    'DATABASE_PASSWORD',
    'DB_PASSWORD',
    'postgres',
  ),
  name: getDatabaseEnvValue(process.env, 'DATABASE_NAME', 'DB_NAME', 'noderax'),
  synchronize:
    getDatabaseEnvValue(
      process.env,
      'DATABASE_SYNCHRONIZE',
      'DB_SYNCHRONIZE',
      'false',
    ) === 'true',
  logging:
    getDatabaseEnvValue(
      process.env,
      'DATABASE_LOGGING',
      'DB_LOGGING',
      'false',
    ) === 'true',
  ssl:
    getDatabaseEnvValue(process.env, 'DATABASE_SSL', 'DB_SSL', 'false') ===
    'true',
  sslCaFile: getDatabaseEnvValue(
    process.env,
    'DATABASE_SSL_CA_FILE',
    'DB_SSL_CA_FILE',
    '',
  ),
}));
