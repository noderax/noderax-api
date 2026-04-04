export const NODE_ROOT_ACCESS_PROFILES = [
  'off',
  'operational',
  'task',
  'terminal',
  'all',
] as const;

export type NodeRootAccessProfile = (typeof NODE_ROOT_ACCESS_PROFILES)[number];

export const NodeRootAccessProfile = {
  OFF: 'off',
  OPERATIONAL: 'operational',
  TASK: 'task',
  TERMINAL: 'terminal',
  ALL: 'all',
} as const satisfies Record<string, NodeRootAccessProfile>;
