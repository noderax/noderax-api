import { BadRequestException } from '@nestjs/common';
import { EventSeverity } from '../events/entities/event-severity.enum';
import type { LogScanEntry } from './log-scan.types';

export const LOG_MONITOR_FIELDS = ['message', 'unit', 'identifier'] as const;
export const LOG_MONITOR_OPERATORS = ['contains', 'equals', 'regex'] as const;

export type LogMonitorField = (typeof LOG_MONITOR_FIELDS)[number];
export type LogMonitorOperator = (typeof LOG_MONITOR_OPERATORS)[number];

export type LogMonitorCondition = {
  field: LogMonitorField;
  op: LogMonitorOperator;
  value: string;
  flags?: string;
};

export type LogMonitorDsl = {
  conditions: {
    all?: LogMonitorCondition[];
    any?: LogMonitorCondition[];
    none?: LogMonitorCondition[];
  };
  threshold: {
    matchCountGte: number;
  };
  incident: {
    severity: EventSeverity;
    titleTemplate: string;
    fingerprintTemplate: string;
    captureLines: number;
  };
};

export type LogMonitorDslEvaluation = {
  matched: boolean;
  matches: LogScanEntry[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const normalizeCondition = (
  value: unknown,
  path: string,
): LogMonitorCondition => {
  if (!isRecord(value)) {
    throw new BadRequestException(`${path} must be an object.`);
  }

  const field = typeof value.field === 'string' ? value.field.trim() : '';
  if (!(LOG_MONITOR_FIELDS as readonly string[]).includes(field)) {
    throw new BadRequestException(
      `${path}.field must be one of ${LOG_MONITOR_FIELDS.join(', ')}.`,
    );
  }

  const op = typeof value.op === 'string' ? value.op.trim() : '';
  if (!(LOG_MONITOR_OPERATORS as readonly string[]).includes(op)) {
    throw new BadRequestException(
      `${path}.op must be one of ${LOG_MONITOR_OPERATORS.join(', ')}.`,
    );
  }

  const rawValue = typeof value.value === 'string' ? value.value : '';
  const normalizedValue = rawValue.trim();
  if (!normalizedValue) {
    throw new BadRequestException(`${path}.value must be a non-empty string.`);
  }

  const flags =
    typeof value.flags === 'string' && value.flags.trim()
      ? value.flags.trim()
      : undefined;

  if (op === 'regex') {
    try {
      // Validate pattern eagerly so invalid DSL is rejected at write time.
      // eslint-disable-next-line no-new
      new RegExp(normalizedValue, flags);
    } catch (error) {
      throw new BadRequestException(
        `${path} contains an invalid regex: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  return {
    field: field as LogMonitorField,
    op: op as LogMonitorOperator,
    value: normalizedValue,
    flags,
  };
};

const normalizeConditionGroup = (
  value: unknown,
  path: string,
): LogMonitorCondition[] | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new BadRequestException(`${path} must be an array.`);
  }

  if (value.length === 0) {
    return undefined;
  }

  return value.map((condition, index) =>
    normalizeCondition(condition, `${path}[${index}]`),
  );
};

export const normalizeLogMonitorDsl = (value: unknown): LogMonitorDsl => {
  if (!isRecord(value)) {
    throw new BadRequestException('dsl must be an object.');
  }

  const conditions = isRecord(value.conditions) ? value.conditions : {};
  const all = normalizeConditionGroup(conditions.all, 'dsl.conditions.all');
  const any = normalizeConditionGroup(conditions.any, 'dsl.conditions.any');
  const none = normalizeConditionGroup(conditions.none, 'dsl.conditions.none');

  if (!all && !any && !none) {
    throw new BadRequestException(
      'dsl.conditions must contain at least one non-empty group.',
    );
  }

  const threshold = isRecord(value.threshold) ? value.threshold : {};
  const rawMatchCount = threshold.matchCountGte;
  const matchCountGte =
    typeof rawMatchCount === 'number' && Number.isInteger(rawMatchCount)
      ? rawMatchCount
      : 1;

  if (matchCountGte < 1 || matchCountGte > 2000) {
    throw new BadRequestException(
      'dsl.threshold.matchCountGte must be between 1 and 2000.',
    );
  }

  const incident = isRecord(value.incident) ? value.incident : {};
  const severity =
    typeof incident.severity === 'string' ? incident.severity.trim() : '';
  if (!Object.values(EventSeverity).includes(severity as EventSeverity)) {
    throw new BadRequestException(
      'dsl.incident.severity must be info, warning, or critical.',
    );
  }

  const titleTemplate =
    typeof incident.titleTemplate === 'string'
      ? incident.titleTemplate.trim()
      : '';
  if (!titleTemplate) {
    throw new BadRequestException(
      'dsl.incident.titleTemplate must be a non-empty string.',
    );
  }

  const fingerprintTemplate =
    typeof incident.fingerprintTemplate === 'string'
      ? incident.fingerprintTemplate.trim()
      : '';
  if (!fingerprintTemplate) {
    throw new BadRequestException(
      'dsl.incident.fingerprintTemplate must be a non-empty string.',
    );
  }

  const rawCaptureLines = incident.captureLines;
  const captureLines =
    typeof rawCaptureLines === 'number' && Number.isInteger(rawCaptureLines)
      ? rawCaptureLines
      : 20;

  if (captureLines < 1 || captureLines > 200) {
    throw new BadRequestException(
      'dsl.incident.captureLines must be between 1 and 200.',
    );
  }

  return {
    conditions: { all, any, none },
    threshold: { matchCountGte },
    incident: {
      severity: severity as EventSeverity,
      titleTemplate,
      fingerprintTemplate,
      captureLines,
    },
  };
};

const readEntryField = (
  entry: LogScanEntry,
  field: LogMonitorField,
): string => {
  const value = entry[field];
  return typeof value === 'string' ? value : '';
};

const matchesCondition = (
  entry: LogScanEntry,
  condition: LogMonitorCondition,
): boolean => {
  const fieldValue = readEntryField(entry, condition.field);

  switch (condition.op) {
    case 'contains':
      return fieldValue.toLowerCase().includes(condition.value.toLowerCase());
    case 'equals':
      return fieldValue === condition.value;
    case 'regex':
      return new RegExp(condition.value, condition.flags).test(fieldValue);
    default:
      return false;
  }
};

const matchesEntry = (entry: LogScanEntry, dsl: LogMonitorDsl): boolean => {
  const { all, any, none } = dsl.conditions;

  if (all && all.some((condition) => !matchesCondition(entry, condition))) {
    return false;
  }

  if (
    any &&
    any.length > 0 &&
    !any.some((condition) => matchesCondition(entry, condition))
  ) {
    return false;
  }

  if (none && none.some((condition) => matchesCondition(entry, condition))) {
    return false;
  }

  return true;
};

export const evaluateLogMonitorDsl = (
  dsl: LogMonitorDsl,
  entries: LogScanEntry[],
): LogMonitorDslEvaluation => {
  const matches = entries.filter((entry) => matchesEntry(entry, dsl));

  return {
    matched: matches.length >= dsl.threshold.matchCountGte,
    matches,
  };
};

export const renderLogMonitorTemplate = (
  template: string,
  entry: LogScanEntry | null | undefined,
  sourcePresetId: string,
): string => {
  const fallbackEntry = entry ?? { message: '', unit: '', identifier: '' };
  return template
    .replaceAll('{{message}}', fallbackEntry.message ?? '')
    .replaceAll('{{unit}}', fallbackEntry.unit ?? '')
    .replaceAll('{{identifier}}', fallbackEntry.identifier ?? '')
    .replaceAll('{{sourcePresetId}}', sourcePresetId)
    .trim();
};
