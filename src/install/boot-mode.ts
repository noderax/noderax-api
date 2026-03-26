import {
  applyInstallStateEnv,
  BOOT_MODE_ENV,
  type InstallState,
} from './install-state';

export type BootMode = 'setup' | 'installed' | 'legacy';

const hasRequiredValue = (value?: string | null) =>
  typeof value === 'string' && value.trim().length > 0;

export const hasLegacyRuntimeEnv = () => {
  const requiredKeys = [
    'DB_HOST',
    'DB_USERNAME',
    'DB_PASSWORD',
    'DB_NAME',
    'JWT_SECRET',
    'AGENT_ENROLLMENT_TOKEN',
  ];

  const redisRequired =
    process.env.REDIS_ENABLED === 'false' ? [] : ['REDIS_HOST'];

  return [...requiredKeys, ...redisRequired].every((key) =>
    hasRequiredValue(process.env[key]),
  );
};

export const resolveBootMode = (
  installState: InstallState | null,
): BootMode => {
  if (installState) {
    return 'installed';
  }

  if (hasLegacyRuntimeEnv()) {
    return 'legacy';
  }

  return 'setup';
};

export const prepareBootEnvironment = (installState: InstallState | null) => {
  const bootMode = resolveBootMode(installState);

  if (installState) {
    applyInstallStateEnv(installState);
  }

  process.env[BOOT_MODE_ENV] = bootMode;
  return bootMode;
};
