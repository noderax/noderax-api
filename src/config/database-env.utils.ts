const DATABASE_ENV_ALIASES = [
  ['DATABASE_HOST', 'DB_HOST'],
  ['DATABASE_PORT', 'DB_PORT'],
  ['DATABASE_USERNAME', 'DB_USERNAME'],
  ['DATABASE_PASSWORD', 'DB_PASSWORD'],
  ['DATABASE_NAME', 'DB_NAME'],
  ['DATABASE_SYNCHRONIZE', 'DB_SYNCHRONIZE'],
  ['DATABASE_LOGGING', 'DB_LOGGING'],
  ['DATABASE_SSL', 'DB_SSL'],
] as const;

type DatabaseEnvAlias = (typeof DATABASE_ENV_ALIASES)[number];
type EnvRecord = Record<string, string | undefined>;

const hasValue = (value?: string | null): value is string =>
  typeof value === 'string' && value.trim().length > 0;

export function normalizeDatabaseEnvAliases(env: EnvRecord = process.env) {
  for (const [canonicalKey, legacyKey] of DATABASE_ENV_ALIASES) {
    const canonicalValue = env[canonicalKey];
    const legacyValue = env[legacyKey];

    if (hasValue(canonicalValue)) {
      env[legacyKey] = canonicalValue;
      continue;
    }

    if (hasValue(legacyValue)) {
      env[canonicalKey] = legacyValue;
    }
  }
}

export function getDatabaseEnvValue(
  env: EnvRecord,
  canonicalKey: DatabaseEnvAlias[0],
  legacyKey: DatabaseEnvAlias[1],
  fallback: string,
) {
  if (hasValue(env[canonicalKey])) {
    return env[canonicalKey];
  }

  if (hasValue(env[legacyKey])) {
    return env[legacyKey];
  }

  return fallback;
}
