import { isWildcardCorsOrigin } from './cors.utils';

type ProductionSecurityInput = {
  bootMode: 'setup' | 'installed';
  nodeEnv: string;
  corsOrigin: string;
  jwtSecret: string;
  secretsEncryptionKey: string;
  adminEmail: string;
  adminPassword: string;
  agentEnrollmentToken?: string | null;
};

const equalsAny = (value: string, candidates: string[]) =>
  candidates.some((candidate) => value.trim() === candidate);

export const assertSafeProductionConfiguration = (
  input: ProductionSecurityInput,
) => {
  if (input.nodeEnv !== 'production' || input.bootMode === 'setup') {
    return;
  }

  const issues: string[] = [];

  if (isWildcardCorsOrigin(input.corsOrigin)) {
    issues.push(
      `CORS_ORIGIN must list explicit origins in production. Use values such as "https://dash.noderax.net". Current value: "${input.corsOrigin || '*'}".`,
    );
  }

  if (equalsAny(input.jwtSecret, ['noderax-local-secret', 'test-secret'])) {
    issues.push('JWT_SECRET must be replaced with a unique production secret.');
  }

  if (
    equalsAny(input.secretsEncryptionKey, [
      'noderax-local-secrets-key-change-me',
      'test-secrets-encryption-key',
    ])
  ) {
    issues.push(
      'SECRETS_ENCRYPTION_KEY must be replaced with a unique production key.',
    );
  }

  if (
    equalsAny(input.adminPassword, ['ChangeMe123!', 'change-me', 'password'])
  ) {
    issues.push('ADMIN_PASSWORD must be changed before production startup.');
  }

  if (equalsAny(input.adminEmail, ['admin@example.com'])) {
    issues.push('ADMIN_EMAIL must not use the example default in production.');
  }

  if (
    input.agentEnrollmentToken &&
    equalsAny(input.agentEnrollmentToken, [
      'secret-enrollment-token',
      'change-me',
    ])
  ) {
    issues.push(
      'AGENT_ENROLLMENT_TOKEN must be replaced with a unique production token.',
    );
  }

  if (!issues.length) {
    return;
  }

  throw new Error(
    `Unsafe production configuration detected:\n- ${issues.join('\n- ')}`,
  );
};
