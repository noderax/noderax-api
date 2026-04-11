import {
  applyInstallSecretEnv,
  applyInstallStateEnv,
  BOOT_MODE_ENV,
  type InstallState,
  readInstallSecrets,
} from './install-state';
import { Client } from 'pg';
import { normalizeDatabaseEnvAliases } from '../config/database-env.utils';
import { isWildcardCorsOrigin } from '../config/cors.utils';
import { buildPostgresSslOptions } from '../config/database-ssl.utils';

export type BootMode = 'setup' | 'installed' | 'legacy';

const LEGACY_CORE_SCHEMA_TABLES = [
  'users',
  'nodes',
  'tasks',
  'events',
  'metrics',
] as const;

const LEGACY_BOOTSTRAPPABLE_SCHEMA_TABLES = [
  'enrollments',
  'scheduled_tasks',
] as const;

const LEGACY_SCHEMA_TABLES = [
  ...LEGACY_CORE_SCHEMA_TABLES,
  ...LEGACY_BOOTSTRAPPABLE_SCHEMA_TABLES,
] as const;

const hasRequiredValue = (value?: string | null) =>
  typeof value === 'string' && value.trim().length > 0;

const isTrue = (value?: string | null) =>
  typeof value === 'string' &&
  ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());

const trim = (value?: string | null) =>
  typeof value === 'string' ? value.trim() : '';

const isSetupRuntimeRole = () => trim(process.env.NODERAX_RUNTIME_ROLE) === 'setup';
const hasInstallerPresetMode = () =>
  hasRequiredValue(process.env.NODERAX_INSTALLER_PRESET_MODE);
const isInstallerSetupContext = () =>
  isSetupRuntimeRole() || hasInstallerPresetMode();

const equalsAny = (value: string, candidates: string[]) =>
  candidates.some((candidate) => trim(value) === candidate);

export const shouldPreferProcessEnvOverInstallState = (input: {
  key: string;
  currentValue: string | undefined;
  incomingValue: string;
}) => {
  const currentValue = trim(input.currentValue);
  const incomingValue = trim(input.incomingValue);

  if (!currentValue || !incomingValue) {
    return false;
  }

  switch (input.key) {
    case 'CORS_ORIGIN':
      return (
        !isWildcardCorsOrigin(currentValue) &&
        isWildcardCorsOrigin(incomingValue)
      );
    case 'SWAGGER_ENABLED':
      return currentValue === 'false' && incomingValue === 'true';
    case 'JWT_SECRET':
      return (
        !equalsAny(currentValue, ['noderax-local-secret', 'test-secret']) &&
        equalsAny(incomingValue, ['noderax-local-secret', 'test-secret'])
      );
    case 'SECRETS_ENCRYPTION_KEY':
      return (
        !equalsAny(currentValue, [
          'noderax-local-secrets-key-change-me',
          'test-secrets-encryption-key',
        ]) &&
        equalsAny(incomingValue, [
          'noderax-local-secrets-key-change-me',
          'test-secrets-encryption-key',
        ])
      );
    case 'ADMIN_EMAIL':
      return (
        !equalsAny(currentValue, ['admin@example.com']) &&
        equalsAny(incomingValue, ['admin@example.com'])
      );
    case 'ADMIN_PASSWORD':
      return (
        !equalsAny(currentValue, ['ChangeMe123!', 'change-me', 'password']) &&
        equalsAny(incomingValue, ['ChangeMe123!', 'change-me', 'password'])
      );
    case 'SEED_DEFAULT_ADMIN':
      return currentValue === 'false' && incomingValue === 'true';
    case 'AGENT_ENROLLMENT_TOKEN':
      return (
        !equalsAny(currentValue, ['secret-enrollment-token', 'change-me']) &&
        equalsAny(incomingValue, ['secret-enrollment-token', 'change-me'])
      );
    default:
      return false;
  }
};

export const hasLegacyRuntimeEnv = () => {
  normalizeDatabaseEnvAliases();

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

const detectLegacySchemaState = async (): Promise<
  'present' | 'partial' | 'absent' | 'unknown'
> => {
  normalizeDatabaseEnvAliases();

  if (!hasLegacyRuntimeEnv()) {
    return 'absent';
  }

  const client = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: buildPostgresSslOptions({
      enabled: isTrue(process.env.DB_SSL),
      caFile:
        trim(process.env.DATABASE_SSL_CA_FILE) ||
        trim(process.env.DB_SSL_CA_FILE),
    }),
  });

  try {
    await client.connect();
    const result = await client.query<{ tableName: string }>(
      `
        SELECT table_name AS "tableName"
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = ANY($1::text[])
      `,
      [LEGACY_SCHEMA_TABLES],
    );

    const existingTables = new Set(result.rows.map((row) => row.tableName));
    const hasAnyLegacyTable = LEGACY_SCHEMA_TABLES.some((tableName) =>
      existingTables.has(tableName),
    );
    const hasCompleteCoreSchema = LEGACY_CORE_SCHEMA_TABLES.every((tableName) =>
      existingTables.has(tableName),
    );

    if (hasCompleteCoreSchema) {
      return 'present';
    }

    return hasAnyLegacyTable ? 'partial' : 'absent';
  } catch {
    return 'unknown';
  } finally {
    await client.end().catch(() => undefined);
  }
};

export const resolveBootMode = (
  installState: InstallState | null,
): Promise<BootMode> => {
  if (isInstallerSetupContext()) {
    return Promise.resolve('setup');
  }

  if (installState) {
    return Promise.resolve('installed');
  }

  if (!hasLegacyRuntimeEnv()) {
    return Promise.resolve('setup');
  }

  return detectLegacySchemaState().then((schemaState) =>
    schemaState === 'present' || schemaState === 'unknown' ? 'legacy' : 'setup',
  );
};

export const prepareBootEnvironment = async (
  installState: InstallState | null,
) => {
  const bootMode = await resolveBootMode(installState);
  const installSecrets = readInstallSecrets();

  if (installState) {
    applyInstallStateEnv(installState, {
      shouldPreserveExisting: shouldPreferProcessEnvOverInstallState,
    });
  }

  if (installSecrets) {
    applyInstallSecretEnv(installSecrets, {
      shouldPreserveExisting: shouldPreferProcessEnvOverInstallState,
    });
  }

  normalizeDatabaseEnvAliases();

  process.env[BOOT_MODE_ENV] = bootMode;
  return bootMode;
};
