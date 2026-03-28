import { Request } from 'express';
import { AuthenticatedUser } from '../types/authenticated-user.type';
import { RequestAuditContext } from '../types/request-audit-context.type';

export const buildRequestAuditContext = (
  actor: AuthenticatedUser,
  request: Request,
): RequestAuditContext => ({
  actorType: 'user',
  actorUserId: actor.id,
  actorEmailSnapshot: actor.email,
  ipAddress: request.ip ?? null,
  userAgent: request.headers['user-agent'] ?? null,
});
