export type LogScanMode = 'preview' | 'monitor';

export type LogScanEntry = {
  timestamp?: string | null;
  message: string;
  unit?: string | null;
  identifier?: string | null;
};

export type LogScanCursorState = {
  journalCursor?: string | null;
  fileInode?: string | null;
  fileOffset?: number | null;
  lastReadAt?: string | null;
  cursorResetReason?: string | null;
};

export type LogScanTaskPayload = {
  mode: LogScanMode;
  sourcePresetId: string;
  limits?: {
    maxLines?: number;
    maxBytes?: number;
    backfillLines?: number;
  };
  cursor?: LogScanCursorState;
  runAsRoot?: boolean;
  rootScope?: 'operational';
  internalContext?: {
    ruleId?: string;
  };
};

export type LogScanTaskResult = {
  sourcePresetId: string;
  sourceType: 'file' | 'journal';
  entries: LogScanEntry[];
  cursor: LogScanCursorState;
  truncated: boolean;
  bytesRead: number;
  linesRead: number;
  warnings: string[];
};
