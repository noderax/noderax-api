export interface RequestAuditContext {
  actorType?: 'user' | 'system';
  actorUserId?: string | null;
  actorEmailSnapshot?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}
