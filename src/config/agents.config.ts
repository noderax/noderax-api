import { registerAs } from '@nestjs/config';

const parsePositiveInteger = (
  value: string | undefined,
  fallback: number,
): number => {
  const parsedValue = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsedValue) && parsedValue > 0
    ? parsedValue
    : fallback;
};

const parsePositiveIntegerWithMin = (
  value: string | undefined,
  fallback: number,
  min: number,
): number => {
  const parsedValue = parsePositiveInteger(value, fallback);
  return Math.max(parsedValue, min);
};

const parseBoolean = (
  value: string | undefined,
  fallback: boolean,
): boolean => {
  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
};

const normalizeUrl = (
  value: string | undefined,
  fallback: string,
  options?: { stripApiPrefix?: boolean },
): string => {
  const candidate = value?.trim() || fallback;

  try {
    const url = new URL(candidate);
    url.hash = '';

    if (options?.stripApiPrefix) {
      url.pathname = url.pathname.replace(/\/(?:api\/)?v1\/?$/i, '') || '/';
    }

    return url.toString().replace(/\/$/, '');
  } catch {
    return fallback;
  }
};

export const AGENTS_CONFIG_KEY = 'agents';

export const agentsConfig = registerAs(AGENTS_CONFIG_KEY, () => ({
  heartbeatTimeoutSeconds: parsePositiveInteger(
    process.env.AGENT_HEARTBEAT_TIMEOUT_SECONDS,
    90,
  ),
  offlineCheckIntervalSeconds: parsePositiveInteger(
    process.env.AGENT_OFFLINE_CHECK_INTERVAL_SECONDS,
    30,
  ),
  realtimePingTimeoutSeconds: parsePositiveIntegerWithMin(
    process.env.AGENT_REALTIME_PING_TIMEOUT_SECONDS,
    45,
    15,
  ),
  realtimePingCheckIntervalSeconds: parsePositiveIntegerWithMin(
    process.env.AGENT_REALTIME_PING_CHECK_INTERVAL_SECONDS,
    5,
    1,
  ),
  taskClaimLeaseSeconds: parsePositiveIntegerWithMin(
    process.env.AGENT_TASK_CLAIM_LEASE_SECONDS,
    60,
    15,
  ),
  enableRealtimeTaskDispatch: parseBoolean(
    process.env.ENABLE_REALTIME_TASK_DISPATCH,
    false,
  ),
  staleTaskCheckIntervalSeconds: parsePositiveInteger(
    process.env.AGENT_STALE_TASK_CHECK_INTERVAL_SECONDS,
    15,
  ),
  staleQueuedTaskTimeoutSeconds: parsePositiveInteger(
    process.env.AGENT_STALE_QUEUED_TASK_TIMEOUT_SECONDS,
    120,
  ),
  staleRunningTaskTimeoutSeconds: parsePositiveInteger(
    process.env.AGENT_STALE_RUNNING_TASK_TIMEOUT_SECONDS,
    1800,
  ),
  enrollmentToken: process.env.AGENT_ENROLLMENT_TOKEN ?? '',
  highCpuThreshold: parseFloat(process.env.AGENT_HIGH_CPU_THRESHOLD ?? '90'),
  publicApiUrl: normalizeUrl(
    process.env.AGENT_PUBLIC_API_URL,
    `http://localhost:${process.env.PORT ?? '3000'}`,
    { stripApiPrefix: true },
  ),
  installScriptUrl: normalizeUrl(
    process.env.AGENT_INSTALL_SCRIPT_URL,
    'https://cdn.noderax.net/noderax-agent/install.sh',
  ),
}));
