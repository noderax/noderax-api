import { registerAs } from '@nestjs/config';

export const agentsConfig = registerAs('agents', () => ({
  heartbeatTimeoutSeconds: parseInt(
    process.env.AGENT_HEARTBEAT_TIMEOUT_SECONDS ?? '90',
    10,
  ),
  highCpuThreshold: parseFloat(process.env.AGENT_HIGH_CPU_THRESHOLD ?? '90'),
}));
