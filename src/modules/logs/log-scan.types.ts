export type LogScanMode = 'preview' | 'monitor';

export type LogScanEntry = {
  timestamp?: string | null;
  message: string;
  unit?: string | null;
  identifier?: string | null;
};

export type LogScanTaskPayload = {
  mode: LogScanMode;
  sourcePresetId: string;
  limits?: {
    maxLines?: number;
    maxBytes?: number;
    backfillLines?: number;
  };
  runAsRoot?: boolean;
  rootScope?: 'operational';
};

export type LogScanTaskResult = {
  sourcePresetId: string;
  sourceType: 'file' | 'journal';
  entries: LogScanEntry[];
  truncated: boolean;
  bytesRead: number;
  linesRead: number;
  warnings: string[];
};
