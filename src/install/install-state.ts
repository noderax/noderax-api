import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { dirname, join, resolve } from 'path';

export type InstallState = {
  version: 1;
  source: 'installer';
  installedAt: string;
  runtimeEnv: Record<string, string>;
};

export type InstallStateHealth = {
  path: string;
  configuredValue: string | null;
  usingCustomPath: boolean;
  writable: boolean;
  error: string | null;
};

export type InstallStateEnvMergeOptions = {
  shouldPreserveExisting?: (input: {
    key: string;
    currentValue: string | undefined;
    incomingValue: string;
  }) => boolean;
};

export const INSTALL_STATE_FILENAME = 'install-state.json';
export const INSTALLER_MANAGED_FLAG = 'NODERAX_INSTALLER_MANAGED';
export const BOOT_MODE_ENV = 'NODERAX_BOOT_MODE';

const isIgnorablePermissionMetadataError = (error: unknown) => {
  if (
    !error ||
    typeof error !== 'object' ||
    !('code' in error) ||
    typeof error.code !== 'string'
  ) {
    return false;
  }

  return ['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EROFS'].includes(error.code);
};

const trySetPermissions = (path: string, mode: number) => {
  try {
    chmodSync(path, mode);
  } catch (error) {
    if (!isIgnorablePermissionMetadataError(error)) {
      throw error;
    }
  }
};

const normalizeStateDirValue = (value?: string | null) => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const unquoted =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
      ? trimmed.slice(1, -1).trim()
      : trimmed;

  return unquoted || null;
};

export const getInstallStateDir = () =>
  resolve(
    normalizeStateDirValue(process.env.NODERAX_STATE_DIR) ??
      join(process.cwd(), '.noderax'),
  );

export const getInstallStatePath = () =>
  join(getInstallStateDir(), INSTALL_STATE_FILENAME);

const probeInstallStateWritable = () => {
  const installStatePath = getInstallStatePath();
  const installStateDir = dirname(installStatePath);
  const configuredValue = normalizeStateDirValue(process.env.NODERAX_STATE_DIR);

  try {
    mkdirSync(installStateDir, { recursive: true, mode: 0o700 });
    trySetPermissions(installStateDir, 0o700);
    accessSync(installStateDir, constants.W_OK);

    const probePath = join(
      installStateDir,
      `.install-state-probe-${process.pid}-${Date.now()}`,
    );

    writeFileSync(probePath, 'noderax', {
      encoding: 'utf8',
      mode: 0o600,
    });
    trySetPermissions(probePath, 0o600);
    unlinkSync(probePath);

    return {
      path: installStatePath,
      configuredValue,
      usingCustomPath: Boolean(configuredValue),
      writable: true,
      error: null,
    } satisfies InstallStateHealth;
  } catch (error) {
    return {
      path: installStatePath,
      configuredValue,
      usingCustomPath: Boolean(configuredValue),
      writable: false,
      error: `Install state directory "${installStateDir}" is not writable. Set NODERAX_STATE_DIR to a writable application-data directory, such as a mounted volume, persistent disk, or another writable path outside a read-only app filesystem. Original error: ${
        (error as Error).message
      }`,
    } satisfies InstallStateHealth;
  }
};

export const getInstallStateHealth = (): InstallStateHealth =>
  probeInstallStateWritable();

export const ensureInstallStateWritable = () => {
  const health = probeInstallStateWritable();
  if (!health.writable) {
    throw new Error(health.error ?? 'Install state directory is not writable.');
  }

  return health.path;
};

export const readInstallState = (): InstallState | null => {
  const installStatePath = getInstallStatePath();
  if (!existsSync(installStatePath)) {
    return null;
  }

  const raw = readFileSync(installStatePath, 'utf8');
  const parsed = JSON.parse(raw) as InstallState;

  if (
    parsed?.version !== 1 ||
    parsed?.source !== 'installer' ||
    !parsed.runtimeEnv ||
    typeof parsed.runtimeEnv !== 'object'
  ) {
    throw new Error('Install state file is invalid.');
  }

  return parsed;
};

export const hasInstallState = () => existsSync(getInstallStatePath());

export const applyInstallStateEnv = (
  state: InstallState,
  options?: InstallStateEnvMergeOptions,
) => {
  for (const [key, value] of Object.entries(state.runtimeEnv)) {
    if (
      options?.shouldPreserveExisting?.({
        key,
        currentValue: process.env[key],
        incomingValue: value,
      })
    ) {
      continue;
    }

    process.env[key] = value;
  }

  process.env[INSTALLER_MANAGED_FLAG] = 'true';
};

export const writeInstallState = (state: InstallState) => {
  const installStatePath = ensureInstallStateWritable();

  const tempPath = `${installStatePath}.tmp`;
  writeFileSync(tempPath, JSON.stringify(state, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });
  trySetPermissions(tempPath, 0o600);
  renameSync(tempPath, installStatePath);
  trySetPermissions(installStatePath, 0o600);
};
