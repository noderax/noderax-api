export const NODE_ROOT_ACCESS_PROFILES = [
  'off',
  'operational',
  'task',
  'terminal',
  'operational_task',
  'operational_terminal',
  'task_terminal',
  'all',
] as const;

export type NodeRootAccessProfile = (typeof NODE_ROOT_ACCESS_PROFILES)[number];

export const NodeRootAccessProfile = {
  OFF: 'off',
  OPERATIONAL: 'operational',
  TASK: 'task',
  TERMINAL: 'terminal',
  OPERATIONAL_TASK: 'operational_task',
  OPERATIONAL_TERMINAL: 'operational_terminal',
  TASK_TERMINAL: 'task_terminal',
  ALL: 'all',
} as const satisfies Record<string, NodeRootAccessProfile>;
