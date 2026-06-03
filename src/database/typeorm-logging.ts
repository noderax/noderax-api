import { LoggerOptions } from 'typeorm';

export function resolveTypeOrmLoggingOptions(
  nodeEnv: string | undefined,
  databaseLoggingEnabled: boolean,
): LoggerOptions {
  return nodeEnv === 'production' ? ['error', 'warn'] : databaseLoggingEnabled;
}
