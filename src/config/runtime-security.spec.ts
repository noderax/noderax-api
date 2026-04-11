import { assertSafeProductionConfiguration } from './runtime-security';

describe('assertSafeProductionConfiguration', () => {
  const baseInput = {
    bootMode: 'installed' as const,
    nodeEnv: 'production',
    corsOrigin: 'https://dash.noderax.net',
    swaggerEnabled: false,
    jwtSecret: 'prod-jwt-secret-123',
    secretsEncryptionKey: 'prod-secrets-key-123456',
    adminEmail: 'admin@example.com',
    adminPassword: 'ChangeMe123!',
    seedDefaultAdmin: false,
    agentEnrollmentToken: 'prod-agent-token-123',
  };

  it('allows installed runtime startup when default admin bootstrap values are unused', () => {
    expect(() => assertSafeProductionConfiguration(baseInput)).not.toThrow();
  });

  it('rejects default admin bootstrap values when seeding remains enabled', () => {
    expect(() =>
      assertSafeProductionConfiguration({
        ...baseInput,
        seedDefaultAdmin: true,
      }),
    ).toThrow(/SEED_DEFAULT_ADMIN/);
  });
});
