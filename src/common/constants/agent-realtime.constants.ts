export const AGENT_REALTIME_NAMESPACE = '/agent-realtime';

export const AGENT_REALTIME_CLIENT_EVENTS = {
  AUTH: 'agent.auth',
  METRICS: 'agent.metrics',
  PING: 'agent.ping',
  TERMINAL_ERROR: 'terminal.error',
  TERMINAL_EXITED: 'terminal.exited',
  TERMINAL_OPENED: 'terminal.opened',
  TERMINAL_OUTPUT: 'terminal.output',
  TASK_ACCEPTED: 'task.accepted',
  TASK_COMPLETED: 'task.completed',
  TASK_LOG: 'task.log',
  TASK_STARTED: 'task.started',
} as const;

export const AGENT_REALTIME_SERVER_EVENTS = {
  AUTH_ACK: 'agent.auth.ack',
  AUTH_ERROR: 'agent.auth.error',
  ERROR: 'agent.error',
  TERMINAL_INPUT: 'terminal.input',
  TERMINAL_RESIZE: 'terminal.resize',
  TERMINAL_START: 'terminal.start',
  TERMINAL_STOP: 'terminal.stop',
  TASK_DISPATCH: 'task.dispatch',
} as const;

export const AGENT_REALTIME_REDIS_KEYS = {
  NODE_ROUTE_PREFIX: 'agent-realtime:node-route:',
} as const;

export const AGENT_REALTIME_ROUTE_TTL_SECONDS = 120;
export const AGENT_REALTIME_SLOW_CLIENT_BUFFER_LIMIT = 128;
