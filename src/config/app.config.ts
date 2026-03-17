import { registerAs } from '@nestjs/config';

export const appConfig = registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  apiPrefix: process.env.API_PREFIX ?? '',
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
  swaggerEnabled: process.env.SWAGGER_ENABLED !== 'false',
  swaggerPath: process.env.SWAGGER_PATH ?? 'docs',
}));
