import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'fs';
import { dirname, join, resolve } from 'path';

export type InstallState = {
  version: 1;
  source: 'installer';
  installedAt: string;
  runtimeEnv: Record<string, string>;
};

export const INSTALL_STATE_FILENAME = 'install-state.json';
export const INSTALLER_MANAGED_FLAG = 'NODERAX_INSTALLER_MANAGED';
export const BOOT_MODE_ENV = 'NODERAX_BOOT_MODE';

export const getInstallStateDir = () =>
  resolve(process.env.NODERAX_STATE_DIR ?? join(process.cwd(), '.noderax'));

export const getInstallStatePath = () =>
  join(getInstallStateDir(), INSTALL_STATE_FILENAME);

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

export const applyInstallStateEnv = (state: InstallState) => {
  for (const [key, value] of Object.entries(state.runtimeEnv)) {
    process.env[key] = value;
  }

  process.env[INSTALLER_MANAGED_FLAG] = 'true';
};

export const writeInstallState = (state: InstallState) => {
  const installStatePath = getInstallStatePath();
  const installStateDir = dirname(installStatePath);
  mkdirSync(installStateDir, { recursive: true, mode: 0o700 });
  chmodSync(installStateDir, 0o700);

  const tempPath = `${installStatePath}.tmp`;
  writeFileSync(tempPath, JSON.stringify(state, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });
  chmodSync(tempPath, 0o600);
  renameSync(tempPath, installStatePath);
  chmodSync(installStatePath, 0o600);
};
