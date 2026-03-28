import {
  agentsConfig,
  appConfig,
  authConfig,
  bootstrapConfig,
  databaseConfig,
  mailConfig,
  redisConfig,
} from '.';

const configuration = [
  appConfig,
  databaseConfig,
  authConfig,
  redisConfig,
  agentsConfig,
  bootstrapConfig,
  mailConfig,
];

export default configuration;
