import {
  agentsConfig,
  appConfig,
  authConfig,
  bootstrapConfig,
  databaseConfig,
  redisConfig,
} from '.';

const configuration = [
  appConfig,
  databaseConfig,
  authConfig,
  redisConfig,
  agentsConfig,
  bootstrapConfig,
];

export default configuration;
