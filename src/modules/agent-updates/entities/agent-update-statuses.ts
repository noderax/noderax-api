export const AGENT_UPDATE_ROLLOUT_STATUSES = [
  'queued',
  'running',
  'paused',
  'completed',
  'cancelled',
] as const;

export type AgentUpdateRolloutStatus =
  (typeof AGENT_UPDATE_ROLLOUT_STATUSES)[number];

export const AGENT_UPDATE_TARGET_ACTIVE_STATUSES = [
  'dispatched',
  'downloading',
  'verifying',
  'installing',
  'restarting',
  'waiting_for_reconnect',
] as const;

export const AGENT_UPDATE_TARGET_TERMINAL_STATUSES = [
  'completed',
  'failed',
  'skipped',
  'cancelled',
] as const;

export const AGENT_UPDATE_TARGET_STATUSES = [
  'pending',
  ...AGENT_UPDATE_TARGET_ACTIVE_STATUSES,
  ...AGENT_UPDATE_TARGET_TERMINAL_STATUSES,
] as const;

export type AgentUpdateTargetStatus =
  (typeof AGENT_UPDATE_TARGET_STATUSES)[number];

export const AGENT_RELEASE_CHANNELS = ['tag'] as const;
export type AgentReleaseChannel = (typeof AGENT_RELEASE_CHANNELS)[number];
