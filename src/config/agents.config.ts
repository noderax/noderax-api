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
  realtimePingTimeoutSeconds: parsePositiveInteger(
    process.env.AGENT_REALTIME_PING_TIMEOUT_SECONDS,
    45,
  ),
  realtimePingCheckIntervalSeconds: parsePositiveInteger(
    process.env.AGENT_REALTIME_PING_CHECK_INTERVAL_SECONDS,
    5,
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
}));
