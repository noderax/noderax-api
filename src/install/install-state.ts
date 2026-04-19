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
  version: 1 | 2;
  source: 'installer';
  installedAt: string;
  runtimeEnv?: Record<string, string>;
  managedEnv?: Record<string, string>;
};

export type InstallSecretState = {
  version: 1;
  source: 'installer';
  updatedAt: string;
  secrets: Record<string, string>;
};

export type InstallTransitionState = {
  version: 1;
  source: 'installer';
  status: 'promoting';
  target: 'runtime_ha';
  updatedAt: string;
  details?: Record<string, string>;
};

export type PlatformReleaseState = {
  version: string;
  releaseId: string;
  releasedAt: string | null;
  builtAt?: string | null;
  bundleSha256?: string | null;
  bundleUrl?: string | null;
  manifestUrl?: string | null;
};

export type PlatformUpdateOperation = 'download' | 'apply';

export type PlatformUpdateStatus =
  | 'queued'
  | 'downloading'
  | 'verifying'
  | 'extracting'
  | 'loading_images'
  | 'prepared'
  | 'applying'
  | 'recreating_services'
  | 'completed'
  | 'failed';

export type PlatformUpdateRequestState = {
  version: 1;
  source: 'installer';
  requestId: string;
  operation: PlatformUpdateOperation;
  requestedAt: string;
  requestedByUserId: string | null;
  requestedByEmailSnapshot: string | null;
  targetReleaseId: string | null;
};

export type PlatformApiRestartRequestState = {
  version: 1;
  source: 'installer';
  requestId: string;
  requestedAt: string;
  requestedByUserId: string | null;
  requestedByEmailSnapshot: string | null;
};

export type PlatformUpdateState = {
  version: 1;
  source: 'installer';
  operation: PlatformUpdateOperation;
  status: PlatformUpdateStatus;
  requestedAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  requestedByUserId: string | null;
  requestedByEmailSnapshot: string | null;
  currentRelease: PlatformReleaseState | null;
  targetRelease: PlatformReleaseState | null;
  preparedRelease: PlatformReleaseState | null;
  previousRelease: PlatformReleaseState | null;
  message: string | null;
  error: string | null;
  rollbackStatus: 'not_needed' | 'succeeded' | 'failed' | null;
  auditLoggedAt?: string | null;
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
export const INSTALL_SECRETS_FILENAME = 'install-secrets.json';
export const INSTALL_TRANSITION_FILENAME = 'install-transition.json';
export const PLATFORM_UPDATE_REQUEST_FILENAME = 'platform-update-request.json';
export const PLATFORM_UPDATE_STATE_FILENAME = 'platform-update-state.json';
export const PLATFORM_API_RESTART_REQUEST_FILENAME =
  'platform-api-restart-request.json';
export const INSTALLER_MANAGED_FLAG = 'NODERAX_INSTALLER_MANAGED';
export const BOOT_MODE_ENV = 'NODERAX_BOOT_MODE';

const INSTALL_SECRET_KEYS = new Set([
  'DATABASE_PASSWORD',
  'DB_PASSWORD',
  'JWT_SECRET',
  'SECRETS_ENCRYPTION_KEY',
  'SMTP_PASSWORD',
  'AGENT_ENROLLMENT_TOKEN',
]);

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

export const getInstallSecretsPath = () =>
  join(getInstallStateDir(), INSTALL_SECRETS_FILENAME);

export const getInstallTransitionPath = () =>
  join(getInstallStateDir(), INSTALL_TRANSITION_FILENAME);

export const getPlatformUpdateRequestPath = () =>
  join(getInstallStateDir(), PLATFORM_UPDATE_REQUEST_FILENAME);

export const getPlatformUpdateStatePath = () =>
  join(getInstallStateDir(), PLATFORM_UPDATE_STATE_FILENAME);

export const getPlatformApiRestartRequestPath = () =>
  join(getInstallStateDir(), PLATFORM_API_RESTART_REQUEST_FILENAME);

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
  const managedEnv =
    parsed.managedEnv ??
    (parsed.version === 1 && parsed.runtimeEnv ? parsed.runtimeEnv : undefined);

  if (
    (parsed?.version !== 1 && parsed?.version !== 2) ||
    parsed?.source !== 'installer' ||
    !managedEnv ||
    typeof managedEnv !== 'object'
  ) {
    throw new Error('Install state file is invalid.');
  }

  return {
    ...parsed,
    managedEnv,
  };
};

export const hasInstallState = () => existsSync(getInstallStatePath());

export const readManagedInstallEnv = (state: InstallState) =>
  state.managedEnv ?? state.runtimeEnv ?? {};

export const splitInstallerEnv = (input: Record<string, string>) => {
  const managedEnv: Record<string, string> = {};
  const secretEnv: Record<string, string> = {};

  for (const [key, value] of Object.entries(input)) {
    if (INSTALL_SECRET_KEYS.has(key)) {
      secretEnv[key] = value;
      continue;
    }

    managedEnv[key] = value;
  }

  return { managedEnv, secretEnv };
};

export const applyInstallStateEnv = (
  state: InstallState,
  options?: InstallStateEnvMergeOptions,
) => {
  for (const [key, value] of Object.entries(readManagedInstallEnv(state))) {
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

export const readInstallSecrets = (): InstallSecretState | null => {
  const installSecretsPath = getInstallSecretsPath();
  if (!existsSync(installSecretsPath)) {
    return null;
  }

  const raw = readFileSync(installSecretsPath, 'utf8');
  const parsed = JSON.parse(raw) as InstallSecretState;

  if (
    parsed?.version !== 1 ||
    parsed?.source !== 'installer' ||
    !parsed.secrets ||
    typeof parsed.secrets !== 'object'
  ) {
    throw new Error('Install secrets file is invalid.');
  }

  return parsed;
};

export const readInstallTransitionState = (): InstallTransitionState | null => {
  const transitionPath = getInstallTransitionPath();
  if (!existsSync(transitionPath)) {
    return null;
  }

  const raw = readFileSync(transitionPath, 'utf8');
  const parsed = JSON.parse(raw) as InstallTransitionState;

  if (
    parsed?.version !== 1 ||
    parsed?.source !== 'installer' ||
    parsed?.status !== 'promoting' ||
    parsed?.target !== 'runtime_ha'
  ) {
    throw new Error('Install transition file is invalid.');
  }

  return parsed;
};

export const readPlatformUpdateRequestState =
  (): PlatformUpdateRequestState | null => {
    const requestPath = getPlatformUpdateRequestPath();
    if (!existsSync(requestPath)) {
      return null;
    }

    const raw = readFileSync(requestPath, 'utf8');
    const parsed = JSON.parse(raw) as PlatformUpdateRequestState;

    if (
      parsed?.version !== 1 ||
      parsed?.source !== 'installer' ||
      (parsed?.operation !== 'download' && parsed?.operation !== 'apply') ||
      typeof parsed?.requestId !== 'string' ||
      typeof parsed?.requestedAt !== 'string'
    ) {
      throw new Error('Platform update request file is invalid.');
    }

    return parsed;
  };

export const readPlatformApiRestartRequestState =
  (): PlatformApiRestartRequestState | null => {
    const requestPath = getPlatformApiRestartRequestPath();
    if (!existsSync(requestPath)) {
      return null;
    }

    const raw = readFileSync(requestPath, 'utf8');
    const parsed = JSON.parse(raw) as PlatformApiRestartRequestState;

    if (
      parsed?.version !== 1 ||
      parsed?.source !== 'installer' ||
      typeof parsed?.requestId !== 'string' ||
      typeof parsed?.requestedAt !== 'string'
    ) {
      throw new Error('Platform API restart request file is invalid.');
    }

    return parsed;
  };

export const readPlatformUpdateState = (): PlatformUpdateState | null => {
  const statePath = getPlatformUpdateStatePath();
  if (!existsSync(statePath)) {
    return null;
  }

  const raw = readFileSync(statePath, 'utf8');
  const parsed = JSON.parse(raw) as PlatformUpdateState;

  if (
    parsed?.version !== 1 ||
    parsed?.source !== 'installer' ||
    (parsed?.operation !== 'download' && parsed?.operation !== 'apply') ||
    ![
      'queued',
      'downloading',
      'verifying',
      'extracting',
      'loading_images',
      'prepared',
      'applying',
      'recreating_services',
      'completed',
      'failed',
    ].includes(parsed?.status)
  ) {
    throw new Error('Platform update state file is invalid.');
  }

  return parsed;
};

export const applyInstallSecretEnv = (
  state: InstallSecretState,
  options?: InstallStateEnvMergeOptions,
) => {
  for (const [key, value] of Object.entries(state.secrets)) {
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
};

export const writeInstallState = (state: InstallState) => {
  const installStatePath = ensureInstallStateWritable();

  const tempPath = `${installStatePath}.tmp`;
  const persistedState: InstallState = {
    version: 2,
    source: state.source,
    installedAt: state.installedAt,
    managedEnv: readManagedInstallEnv(state),
  };

  writeFileSync(tempPath, JSON.stringify(persistedState, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });
  trySetPermissions(tempPath, 0o600);
  renameSync(tempPath, installStatePath);
  trySetPermissions(installStatePath, 0o600);
};

export const writeInstallSecrets = (secrets: Record<string, string>) => {
  const installSecretsPath = getInstallSecretsPath();
  ensureInstallStateWritable();

  if (Object.keys(secrets).length === 0) {
    if (existsSync(installSecretsPath)) {
      unlinkSync(installSecretsPath);
    }
    return;
  }

  const payload: InstallSecretState = {
    version: 1,
    source: 'installer',
    updatedAt: new Date().toISOString(),
    secrets,
  };

  const tempPath = `${installSecretsPath}.tmp`;
  writeFileSync(tempPath, JSON.stringify(payload, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });
  trySetPermissions(tempPath, 0o600);
  renameSync(tempPath, installSecretsPath);
  trySetPermissions(installSecretsPath, 0o600);
};

export const writeInstallTransitionState = (
  transition: Omit<InstallTransitionState, 'version' | 'source' | 'updatedAt'>,
) => {
  const transitionPath = getInstallTransitionPath();
  ensureInstallStateWritable();

  const payload: InstallTransitionState = {
    version: 1,
    source: 'installer',
    updatedAt: new Date().toISOString(),
    ...transition,
  };

  const tempPath = `${transitionPath}.tmp`;
  writeFileSync(tempPath, JSON.stringify(payload, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });
  trySetPermissions(tempPath, 0o600);
  renameSync(tempPath, transitionPath);
  trySetPermissions(transitionPath, 0o600);
};

export const clearInstallTransitionState = () => {
  const transitionPath = getInstallTransitionPath();
  if (!existsSync(transitionPath)) {
    return;
  }

  unlinkSync(transitionPath);
};

export const writePlatformApiRestartRequestState = (
  request: Omit<PlatformApiRestartRequestState, 'version' | 'source'>,
) => {
  const requestPath = getPlatformApiRestartRequestPath();
  const payload: PlatformApiRestartRequestState = {
    version: 1,
    source: 'installer',
    ...request,
  };

  writeInstallerStateFile(requestPath, payload);
};

export const clearPlatformApiRestartRequestState = () => {
  const requestPath = getPlatformApiRestartRequestPath();
  if (!existsSync(requestPath)) {
    return;
  }

  unlinkSync(requestPath);
};

const writeInstallerStateFile = (path: string, payload: object) => {
  ensureInstallStateWritable();
  const tempPath = `${path}.tmp`;
  writeFileSync(tempPath, JSON.stringify(payload, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });
  trySetPermissions(tempPath, 0o600);
  renameSync(tempPath, path);
  trySetPermissions(path, 0o600);
};

export const writePlatformUpdateRequestState = (
  request: Omit<PlatformUpdateRequestState, 'version' | 'source'>,
) => {
  writeInstallerStateFile(getPlatformUpdateRequestPath(), {
    version: 1,
    source: 'installer',
    ...request,
  } satisfies PlatformUpdateRequestState);
};

export const writePlatformUpdateState = (
  state: Omit<PlatformUpdateState, 'version' | 'source' | 'updatedAt'>,
) => {
  writeInstallerStateFile(getPlatformUpdateStatePath(), {
    version: 1,
    source: 'installer',
    updatedAt: new Date().toISOString(),
    ...state,
  } satisfies PlatformUpdateState);
};

export const clearPlatformUpdateRequestState = () => {
  const requestPath = getPlatformUpdateRequestPath();
  if (existsSync(requestPath)) {
    unlinkSync(requestPath);
  }
};

export const clearPlatformUpdateState = () => {
  const statePath = getPlatformUpdateStatePath();
  if (existsSync(statePath)) {
    unlinkSync(statePath);
  }
};
