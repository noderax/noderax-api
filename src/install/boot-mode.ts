import {
  applyInstallStateEnv,
  BOOT_MODE_ENV,
  type InstallState,
} from './install-state';
import { Client } from 'pg';

export type BootMode = 'setup' | 'installed' | 'legacy';

const LEGACY_SCHEMA_TABLES = [
  'users',
  'nodes',
  'tasks',
  'events',
  'metrics',
  'enrollments',
  'scheduled_tasks',
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
  'present' | 'absent' | 'unknown'
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
    const result = await client.query<{ count: string }>(
      `
        SELECT COUNT(*)::int AS "count"
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = ANY($1::text[])
      `,
      [LEGACY_SCHEMA_TABLES],
    );

    return Number(result.rows[0]?.count ?? 0) > 0 ? 'present' : 'absent';
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
    schemaState === 'absent' ? 'setup' : 'legacy',
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
