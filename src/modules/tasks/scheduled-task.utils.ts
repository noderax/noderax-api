import {
  assertValidTimeZone,
  DEFAULT_TIMEZONE,
} from '../../common/utils/timezone.util';

export const SCHEDULED_TASK_CADENCES = ['hourly', 'daily', 'weekly'] as const;
export type ScheduledTaskCadence = (typeof SCHEDULED_TASK_CADENCES)[number];

export const SCHEDULED_TASK_TIMEZONE = DEFAULT_TIMEZONE;
export const SCHEDULED_TASK_RUNNER_INTERVAL_MS = 1000;
export const SCHEDULED_TASK_RUNNER_LEASE_MS = 30_000;

type ScheduledTaskTiming = {
  cadence: ScheduledTaskCadence;
  minute: number;
  hour: number | null;
  dayOfWeek: number | null;
  timezone?: string | null;
};

export function computeNextScheduledRun(
  input: ScheduledTaskTiming,
  from: Date,
): Date {
  const reference = new Date(from);
  const normalizedMinute = clamp(input.minute, 0, 59);
  const normalizedHour = input.hour === null ? null : clamp(input.hour, 0, 23);
  const normalizedDay =
    input.dayOfWeek === null ? null : clamp(input.dayOfWeek, 0, 6);
  const timezone = assertValidTimeZone(
    input.timezone ?? SCHEDULED_TASK_TIMEZONE,
  );

  switch (input.cadence) {
    case 'hourly':
      return computeHourlyRun(normalizedMinute, reference, timezone);
    case 'daily':
      return computeDailyRun(
        normalizedHour ?? 0,
        normalizedMinute,
        reference,
        timezone,
      );
    case 'weekly':
      return computeWeeklyRun(
        normalizedDay ?? 0,
        normalizedHour ?? 0,
        normalizedMinute,
        reference,
        timezone,
      );
    default:
      return computeHourlyRun(normalizedMinute, reference, timezone);
  }
}

export function describeScheduledTask(input: ScheduledTaskTiming): string {
  const minute = input.minute.toString().padStart(2, '0');
  const timezone = input.timezone ?? SCHEDULED_TASK_TIMEZONE;

  switch (input.cadence) {
    case 'hourly':
      return `Every hour at :${minute} ${timezone}`;
    case 'daily':
      return `Every day at ${(input.hour ?? 0)
        .toString()
        .padStart(2, '0')}:${minute} ${timezone}`;
    case 'weekly':
      return `Every ${WEEKDAY_LABELS[input.dayOfWeek ?? 0]} at ${(
        input.hour ?? 0
      )
        .toString()
        .padStart(2, '0')}:${minute} ${timezone}`;
    default:
      return 'Scheduled task';
  }
}

const WEEKDAY_LABELS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

type ZonedDateTime = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  dayOfWeek: number;
};

type LocalDateTime = Pick<
  ZonedDateTime,
  'year' | 'month' | 'day' | 'hour' | 'minute'
>;

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const zonedFormatterCache = new Map<string, Intl.DateTimeFormat>();
const offsetFormatterCache = new Map<string, Intl.DateTimeFormat>();

function computeHourlyRun(minute: number, from: Date, timezone: string): Date {
  const candidate = new Date(from);
  candidate.setUTCSeconds(0, 0);

  if (candidate.getTime() <= from.getTime()) {
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  }

  for (let index = 0; index < 180; index += 1) {
    const parts = getZonedDateTimeParts(candidate, timezone);
    if (parts.minute === minute) {
      return candidate;
    }

    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  }

  throw new Error(`Unable to resolve hourly schedule in ${timezone}`);
}

function computeDailyRun(
  hour: number,
  minute: number,
  from: Date,
  timezone: string,
): Date {
  const reference = getZonedDateTimeParts(from, timezone);
  let targetDate: LocalDateTime = {
    year: reference.year,
    month: reference.month,
    day: reference.day,
    hour,
    minute,
  };

  if (compareLocalDateTime(targetDate, reference) <= 0) {
    targetDate = {
      ...addLocalDays(targetDate, 1),
      hour,
      minute,
    };
  }

  return resolveLocalDateTime(targetDate, timezone);
}

function computeWeeklyRun(
  dayOfWeek: number,
  hour: number,
  minute: number,
  from: Date,
  timezone: string,
): Date {
  const reference = getZonedDateTimeParts(from, timezone);
  let dayOffset = dayOfWeek - reference.dayOfWeek;
  if (dayOffset < 0) {
    dayOffset += 7;
  }

  let targetDate: LocalDateTime = {
    ...addLocalDays(reference, dayOffset),
    hour,
    minute,
  };

  if (dayOffset === 0 && compareLocalDateTime(targetDate, reference) <= 0) {
    targetDate = {
      ...addLocalDays(targetDate, 7),
      hour,
      minute,
    };
  }

  return resolveLocalDateTime(targetDate, timezone);
}

function getZonedDateTimeParts(date: Date, timezone: string): ZonedDateTime {
  const formatter =
    zonedFormatterCache.get(timezone) ??
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
  zonedFormatterCache.set(timezone, formatter);

  const partLookup = formatter
    .formatToParts(date)
    .reduce<Record<string, string>>((result, part) => {
      if (part.type !== 'literal') {
        result[part.type] = part.value;
      }
      return result;
    }, {});

  return {
    year: parseInt(partLookup.year ?? '0', 10),
    month: parseInt(partLookup.month ?? '1', 10),
    day: parseInt(partLookup.day ?? '1', 10),
    hour: parseInt(partLookup.hour ?? '0', 10),
    minute: parseInt(partLookup.minute ?? '0', 10),
    second: parseInt(partLookup.second ?? '0', 10),
    dayOfWeek: WEEKDAY_INDEX[partLookup.weekday ?? 'Sun'] ?? 0,
  };
}

function getTimeZoneOffsetMinutes(date: Date, timezone: string): number {
  const formatter =
    offsetFormatterCache.get(timezone) ??
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'shortOffset',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
  offsetFormatterCache.set(timezone, formatter);

  const timeZoneName = formatter
    .formatToParts(date)
    .find((part) => part.type === 'timeZoneName')?.value;

  const match = timeZoneName?.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/);
  if (!match) {
    return 0;
  }

  const [, sign, hourPart, minutePart] = match;
  const minutes = parseInt(hourPart, 10) * 60 + parseInt(minutePart ?? '0', 10);
  return sign === '-' ? -minutes : minutes;
}

function resolveLocalDateTime(target: LocalDateTime, timezone: string): Date {
  const approximateUtcMs = Date.UTC(
    target.year,
    target.month - 1,
    target.day,
    target.hour,
    target.minute,
    0,
    0,
  );
  const approximateDate = new Date(approximateUtcMs);
  const offsetMinutes = getTimeZoneOffsetMinutes(approximateDate, timezone);
  const guessMs = approximateUtcMs - offsetMinutes * 60_000;

  const exactMatches = findMatchingInstants(target, timezone, guessMs);
  if (exactMatches.length > 0) {
    return exactMatches[0];
  }

  const sameMinuteMatch = findGapFallbackInstant(
    target,
    timezone,
    guessMs,
    true,
  );
  if (sameMinuteMatch) {
    return sameMinuteMatch;
  }

  const firstFutureMatch = findGapFallbackInstant(
    target,
    timezone,
    guessMs,
    false,
  );
  if (firstFutureMatch) {
    return firstFutureMatch;
  }

  return new Date(guessMs);
}

function findMatchingInstants(
  target: LocalDateTime,
  timezone: string,
  guessMs: number,
): Date[] {
  const matches: Date[] = [];

  for (let minuteOffset = -180; minuteOffset <= 180; minuteOffset += 1) {
    const candidate = new Date(guessMs + minuteOffset * 60_000);
    const parts = getZonedDateTimeParts(candidate, timezone);

    if (
      parts.year === target.year &&
      parts.month === target.month &&
      parts.day === target.day &&
      parts.hour === target.hour &&
      parts.minute === target.minute
    ) {
      matches.push(candidate);
    }
  }

  return matches.sort((left, right) => left.getTime() - right.getTime());
}

function findGapFallbackInstant(
  target: LocalDateTime,
  timezone: string,
  guessMs: number,
  preserveMinute: boolean,
): Date | null {
  for (let minuteOffset = 0; minuteOffset <= 240; minuteOffset += 1) {
    const candidate = new Date(guessMs + minuteOffset * 60_000);
    const parts = getZonedDateTimeParts(candidate, timezone);

    if (
      parts.year !== target.year ||
      parts.month !== target.month ||
      parts.day !== target.day
    ) {
      continue;
    }

    if (preserveMinute && parts.minute !== target.minute) {
      continue;
    }

    if (compareLocalDateTime(parts, target) > 0) {
      return candidate;
    }
  }

  return null;
}

function addLocalDays(
  value: Pick<LocalDateTime, 'year' | 'month' | 'day'>,
  days: number,
): Pick<LocalDateTime, 'year' | 'month' | 'day'> {
  const date = new Date(Date.UTC(value.year, value.month - 1, value.day));
  date.setUTCDate(date.getUTCDate() + days);

  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function compareLocalDateTime(
  left: Pick<LocalDateTime, 'year' | 'month' | 'day' | 'hour' | 'minute'>,
  right: Pick<LocalDateTime, 'year' | 'month' | 'day' | 'hour' | 'minute'>,
): number {
  return (
    Date.UTC(left.year, left.month - 1, left.day, left.hour, left.minute) -
    Date.UTC(right.year, right.month - 1, right.day, right.hour, right.minute)
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
