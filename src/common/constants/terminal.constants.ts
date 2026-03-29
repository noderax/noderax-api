export const TERMINAL_NAMESPACE = '/terminal';

export const TERMINAL_EVENTS = {
  ATTACH: 'terminal.attach',
  INPUT: 'terminal.input',
  RESIZE: 'terminal.resize',
  TERMINATE: 'terminal.terminate',
  SESSION_STATE: 'terminal.session.state',
  OUTPUT: 'terminal.output',
  CLOSED: 'terminal.closed',
  ERROR: 'terminal.error',
} as const;

export const TERMINAL_ERROR_CODES = {
  BAD_REQUEST: 'BAD_REQUEST',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  UNAUTHORIZED: 'UNAUTHORIZED',
  CONFLICT: 'CONFLICT',
} as const;

export const TERMINAL_SESSION_ROOM_PREFIX = 'terminal:session:';

export const TERMINAL_REDIS_KEYS = {
  CONTROLLER_COUNT_PREFIX: 'terminal:controller-count:',
} as const;

export const TERMINAL_TRANSCRIPT_RETENTION_DAYS = 7;
export const TERMINAL_ATTACH_GRACE_SECONDS = 30;
export const TERMINAL_PENDING_OPEN_TIMEOUT_MS = 15_000;
export const TERMINAL_MAX_TRANSCRIPT_BYTES = 10 * 1024 * 1024;
