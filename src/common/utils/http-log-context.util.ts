import { Request } from 'express';
import { AuthenticatedUser } from '../types/authenticated-user.type';

const readString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value : null;

const readScopedId = (request: Request, key: string): string | null =>
  readString(request.params?.[key]) ??
  readString(request.query?.[key]) ??
  readString((request.body as Record<string, unknown> | undefined)?.[key]);

export const buildHttpLogContext = (request: Request) => {
  const correlationId =
    readString(request.headers['x-correlation-id']) ?? 'no-id';
  const actor = (request as Request & { user?: AuthenticatedUser }).user;

  return {
    correlationId,
    method: request.method,
    url: request.originalUrl,
    route: request.route?.path ?? null,
    actorUserId: actor?.id ?? null,
    actorEmail: actor?.email ?? null,
    workspaceId: readScopedId(request, 'workspaceId'),
    nodeId: readScopedId(request, 'nodeId'),
    taskId: readScopedId(request, 'taskId'),
    sessionId: readScopedId(request, 'sessionId'),
  };
};
