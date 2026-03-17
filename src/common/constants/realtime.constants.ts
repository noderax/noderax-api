export const REALTIME_NODE_ROOM_PREFIX = 'node:';

export const REALTIME_EVENTS = {
  EVENT_CREATED: 'event.created',
  METRICS_INGESTED: 'metrics.ingested',
  NODE_STATUS_UPDATED: 'node.status.updated',
  SUBSCRIBE_NODE: 'subscribe.node',
  TASK_CREATED: 'task.created',
  TASK_UPDATED: 'task.updated',
  UNSUBSCRIBE_NODE: 'unsubscribe.node',
} as const;
