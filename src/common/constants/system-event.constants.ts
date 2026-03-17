export const SYSTEM_EVENT_TYPES = {
  HIGH_CPU: 'high.cpu',
  NODE_OFFLINE: 'node.offline',
  NODE_ONLINE: 'node.online',
  NODE_REGISTERED: 'node.registered',
  TASK_CANCELLED: 'task.cancelled',
  TASK_COMPLETED: 'task.completed',
  TASK_FAILED: 'task.failed',
  TASK_QUEUED: 'task.queued',
  TASK_STARTED: 'task.started',
} as const;
