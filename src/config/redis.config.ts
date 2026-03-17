import { registerAs } from '@nestjs/config';

export const REDIS_CONFIG_KEY = 'redis';

export const redisConfig = registerAs(REDIS_CONFIG_KEY, () => ({
  enabled: process.env.REDIS_ENABLED !== 'false',
  url: process.env.REDIS_URL ?? '',
  host: process.env.REDIS_HOST ?? '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
  password: process.env.REDIS_PASSWORD ?? '',
  db: parseInt(process.env.REDIS_DB ?? '0', 10),
  keyPrefix: process.env.REDIS_KEY_PREFIX ?? 'noderax:',
}));
