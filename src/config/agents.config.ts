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

export const agentsConfig = registerAs('agents', () => ({
  heartbeatTimeoutSeconds: parsePositiveInteger(
    process.env.AGENT_HEARTBEAT_TIMEOUT_SECONDS,
    90,
  ),
  offlineCheckIntervalSeconds: parsePositiveInteger(
    process.env.AGENT_OFFLINE_CHECK_INTERVAL_SECONDS,
    30,
  ),
  highCpuThreshold: parseFloat(process.env.AGENT_HIGH_CPU_THRESHOLD ?? '90'),
}));
