import { LogLevel } from '@nestjs/common';

export function resolveNestLogLevels(nodeEnv?: string): LogLevel[] {
  return nodeEnv === 'production'
    ? ['error', 'warn']
    : ['log', 'fatal', 'error', 'warn', 'debug', 'verbose'];
}
