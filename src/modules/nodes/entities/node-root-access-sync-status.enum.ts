export const NODE_ROOT_ACCESS_SYNC_STATUSES = [
  'pending',
  'applied',
  'failed',
] as const;

export type NodeRootAccessSyncStatus =
  (typeof NODE_ROOT_ACCESS_SYNC_STATUSES)[number];

export const NodeRootAccessSyncStatus = {
  PENDING: 'pending',
  APPLIED: 'applied',
  FAILED: 'failed',
} as const satisfies Record<string, NodeRootAccessSyncStatus>;
