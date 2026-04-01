import { shouldPreferProcessEnvOverInstallState } from './boot-mode';

describe('boot-mode safer env preservation', () => {
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

  it('does not override installer state when the incoming value is already explicit', () => {
    expect(
      shouldPreferProcessEnvOverInstallState({
        key: 'CORS_ORIGIN',
        currentValue: 'https://dash.noderax.net',
        incomingValue: 'https://dash-old.noderax.net',
      }),
    ).toBe(false);
  });
});
