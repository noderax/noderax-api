export const PUBSUB_CHANNELS = {
  AGENT_REALTIME_TASK_DISPATCH: 'agent-realtime.task.dispatch',
  AGENT_REALTIME_TERMINAL_CONTROL: 'agent-realtime.terminal.control',
  EVENTS_CREATED: 'events.created',
  METRICS_INGESTED: 'metrics.ingested',
  NODES_STATUS_UPDATED: 'nodes.status.updated',
  TERMINAL_SESSION_CLOSED: 'terminal.session.closed',
  TERMINAL_SESSION_ERROR: 'terminal.session.error',
  TERMINAL_SESSION_OUTPUT: 'terminal.session.output',
  TERMINAL_SESSION_STATE: 'terminal.session.state',
  TASKS_CREATED: 'tasks.created',
  TASKS_UPDATED: 'tasks.updated',
} as const;
