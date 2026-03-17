export default () => ({
  app: {
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port: parseInt(process.env.PORT ?? '3000', 10),
    apiPrefix: process.env.API_PREFIX ?? '',
    corsOrigin: process.env.CORS_ORIGIN ?? '*',
    swaggerEnabled: process.env.SWAGGER_ENABLED !== 'false',
    swaggerPath: process.env.SWAGGER_PATH ?? 'docs',
  },
  database: {
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    username: process.env.DB_USERNAME ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
    name: process.env.DB_NAME ?? 'noderax',
    synchronize: process.env.DB_SYNCHRONIZE !== 'false',
    logging: process.env.DB_LOGGING === 'true',
    ssl: process.env.DB_SSL === 'true',
  },
  auth: {
    jwtSecret: process.env.JWT_SECRET ?? 'noderax-local-secret',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '1d',
    bcryptSaltRounds: parseInt(process.env.BCRYPT_SALT_ROUNDS ?? '12', 10),
  },
  redis: {
    enabled: process.env.REDIS_ENABLED !== 'false',
    url: process.env.REDIS_URL ?? '',
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD ?? '',
    db: parseInt(process.env.REDIS_DB ?? '0', 10),
    keyPrefix: process.env.REDIS_KEY_PREFIX ?? 'noderax:',
  },
  agents: {
    heartbeatTimeoutSeconds: parseInt(
      process.env.AGENT_HEARTBEAT_TIMEOUT_SECONDS ?? '90',
      10,
    ),
    highCpuThreshold: parseFloat(process.env.AGENT_HIGH_CPU_THRESHOLD ?? '90'),
  },
  bootstrap: {
    seedDefaultAdmin: process.env.SEED_DEFAULT_ADMIN !== 'false',
    adminName: process.env.ADMIN_NAME ?? 'Noderax Admin',
    adminEmail: process.env.ADMIN_EMAIL ?? 'admin@noderax.local',
    adminPassword: process.env.ADMIN_PASSWORD ?? 'ChangeMe123!',
  },
});
