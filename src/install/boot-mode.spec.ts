import {
  resolveBootMode,
  shouldPreferProcessEnvOverInstallState,
} from './boot-mode';

describe('boot-mode safer env preservation', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('preserves an explicit process CORS origin over an unsafe install-state wildcard', () => {
    expect(
      shouldPreferProcessEnvOverInstallState({
        key: 'CORS_ORIGIN',
        currentValue: 'https://dash.noderax.net',
        incomingValue: '*',
      }),
    ).toBe(true);
  });

  it('preserves a secure JWT secret over an unsafe install-state default', () => {
    expect(
      shouldPreferProcessEnvOverInstallState({
        key: 'JWT_SECRET',
        currentValue: 'prod-secret-123',
        incomingValue: 'test-secret',
      }),
    ).toBe(true);
  });

  it('preserves an explicit production swagger disable over installer state', () => {
    expect(
      shouldPreferProcessEnvOverInstallState({
        key: 'SWAGGER_ENABLED',
        currentValue: 'false',
        incomingValue: 'true',
      }),
    ).toBe(true);
  });

  it('preserves an explicit production seed disable over installer state', () => {
    expect(
      shouldPreferProcessEnvOverInstallState({
        key: 'SEED_DEFAULT_ADMIN',
        currentValue: 'false',
        incomingValue: 'true',
      }),
    ).toBe(true);
  });

  it('does not override installer state when the incoming value is already explicit', () => {
    expect(
      shouldPreferProcessEnvOverInstallState({
        key: 'CORS_ORIGIN',
        currentValue: 'https://dash.noderax.net',
        incomingValue: 'https://dash-old.noderax.net',
      }),
    ).toBe(false);
  });

  it('forces setup boot mode when the runtime role is setup', async () => {
    process.env.NODERAX_RUNTIME_ROLE = 'setup';
    process.env.DB_HOST = 'postgres';
    process.env.DB_USERNAME = 'postgres';
    process.env.DB_PASSWORD = 'secret';
    process.env.DB_NAME = 'noderax';
    process.env.REDIS_HOST = 'redis';
    process.env.JWT_SECRET = 'jwt-secret';
    process.env.AGENT_ENROLLMENT_TOKEN = 'agent-enrollment-token';

    await expect(resolveBootMode(null)).resolves.toBe('setup');
  });

  it('forces setup boot mode when installer preset mode is present', async () => {
    process.env.NODERAX_INSTALLER_PRESET_MODE = 'local_bundle';
    process.env.DB_HOST = 'postgres';
    process.env.DB_USERNAME = 'postgres';
    process.env.DB_PASSWORD = 'secret';
    process.env.DB_NAME = 'noderax';
    process.env.REDIS_HOST = 'redis';
    process.env.JWT_SECRET = 'jwt-secret';
    process.env.AGENT_ENROLLMENT_TOKEN = 'agent-enrollment-token';

    await expect(resolveBootMode(null)).resolves.toBe('setup');
  });
});
