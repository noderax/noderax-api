import * as Joi from 'joi';

export const validationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(3000),
  API_PREFIX: Joi.string().allow('').default(''),
  CORS_ORIGIN: Joi.string().default('*'),
  SWAGGER_ENABLED: Joi.boolean().default(true),
  SWAGGER_PATH: Joi.string().default('docs'),

  // Database
  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number().default(5432),
  DB_USERNAME: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  DB_NAME: Joi.string().required(),
  DB_SYNCHRONIZE: Joi.boolean().default(false),
  DB_LOGGING: Joi.boolean().default(false),
  DB_SSL: Joi.boolean().default(false),

  // Redis
  REDIS_ENABLED: Joi.boolean().default(true),
  REDIS_URL: Joi.string().allow('').default(''),
  REDIS_HOST: Joi.string().required(),
  REDIS_PORT: Joi.number().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').default(''),
  REDIS_DB: Joi.number().default(0),
  REDIS_KEY_PREFIX: Joi.string().default('noderax:'),

  // Auth
  JWT_SECRET: Joi.string().required(),
  JWT_EXPIRES_IN: Joi.string().default('1d'),
  BCRYPT_SALT_ROUNDS: Joi.number().integer().min(10).default(12),

  // Agents
  AGENT_HEARTBEAT_TIMEOUT_SECONDS: Joi.number().integer().min(1).default(90),
  AGENT_OFFLINE_CHECK_INTERVAL_SECONDS: Joi.number()
    .integer()
    .min(1)
    .default(30),
  AGENT_ENROLLMENT_TOKEN: Joi.string().required(),
  AGENT_HIGH_CPU_THRESHOLD: Joi.number().min(0).max(100).default(90),

  // Bootstrap
  SEED_DEFAULT_ADMIN: Joi.boolean().default(false),
  ADMIN_NAME: Joi.string().default('Noderax Admin'),
  ADMIN_EMAIL: Joi.string().email().default('admin@example.com'),
  ADMIN_PASSWORD: Joi.string().min(8).default('ChangeMe123!'),
});
