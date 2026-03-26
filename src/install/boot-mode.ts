import {
  applyInstallStateEnv,
  BOOT_MODE_ENV,
  type InstallState,
} from './install-state';
import { Client } from 'pg';

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

const detectLegacySchemaState = async (): Promise<
  'present' | 'partial' | 'absent' | 'unknown'
> => {
  if (!hasLegacyRuntimeEnv()) {
    return 'absent';
  }

  const client = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: isTrue(process.env.DB_SSL) ? { rejectUnauthorized: false } : false,
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

  if (installState) {
    applyInstallStateEnv(installState);
  }

  process.env[BOOT_MODE_ENV] = bootMode;
  return bootMode;
};
