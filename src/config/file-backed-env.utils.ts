import { readFileSync } from 'fs';

const FILE_ENV_SUFFIX = '_FILE';

const hasValue = (value?: string | null): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const normalizeFileValue = (value: string) => value.replace(/\r?\n$/, '');
const hasExplicitEnvKey = (env: NodeJS.ProcessEnv, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(env, key);

export function applyFileBackedEnv(env: NodeJS.ProcessEnv = process.env): void {
  for (const [key, filePath] of Object.entries(env)) {
    if (!key.endsWith(FILE_ENV_SUFFIX) || !hasValue(filePath)) {
      continue;
    }

    const targetKey = key.slice(0, -FILE_ENV_SUFFIX.length);
    if (!targetKey || hasExplicitEnvKey(env, targetKey)) {
      continue;
    }

    env[targetKey] = normalizeFileValue(readFileSync(filePath, 'utf8'));
  }
}
