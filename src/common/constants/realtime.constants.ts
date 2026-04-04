export const REALTIME_NODE_ROOM_PREFIX = 'node:';
export const REALTIME_WORKSPACE_ROOM_PREFIX = 'workspace:';

export const REALTIME_EVENTS = {
  EVENT_CREATED: 'event.created',
  METRICS_INGESTED: 'metrics.ingested',
  NODE_INSTALL_UPDATED: 'node-install.updated',
  NODE_ROOT_ACCESS_UPDATED: 'node.root-access.updated',
  NODE_STATUS_UPDATED: 'node.status.updated',
  SUBSCRIBE_NODE: 'subscribe.node',
  SUBSCRIBE_WORKSPACE: 'subscribe.workspace',
  TASK_CREATED: 'task.created',
  TASK_UPDATED: 'task.updated',
  UNSUBSCRIBE_NODE: 'unsubscribe.node',
  UNSUBSCRIBE_WORKSPACE: 'unsubscribe.workspace',
} as const;

export const REALTIME_ERROR_CODES = {
  BAD_REQUEST: 'BAD_REQUEST',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  UNAUTHORIZED: 'UNAUTHORIZED',
} as const;
