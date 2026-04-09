import { BOOT_MODE_ENV } from './install-state';

export const isLegacyBootMode = () =>
  process.env[BOOT_MODE_ENV] === 'legacy' ||
  Boolean(process.env.JEST_WORKER_ID);

export const legacyOnlyProviders = <T>(providers: T[]): T[] =>
  isLegacyBootMode() ? providers : [];
