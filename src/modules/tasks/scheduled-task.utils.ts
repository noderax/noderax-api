export const SCHEDULED_TASK_CADENCES = ['hourly', 'daily', 'weekly'] as const;
export type ScheduledTaskCadence =
  (typeof SCHEDULED_TASK_CADENCES)[number];

export const SCHEDULED_TASK_TIMEZONE = 'UTC' as const;
export const SCHEDULED_TASK_RUNNER_INTERVAL_MS = 1000;
export const SCHEDULED_TASK_RUNNER_LEASE_MS = 30_000;

type ScheduledTaskTiming = {
  cadence: ScheduledTaskCadence;
  minute: number;
  hour: number | null;
  dayOfWeek: number | null;
};

export function computeNextScheduledRun(
  input: ScheduledTaskTiming,
  from: Date,
): Date {
  const reference = new Date(from);
  const normalizedMinute = clamp(input.minute, 0, 59);
  const normalizedHour =
    input.hour === null ? null : clamp(input.hour, 0, 23);
  const normalizedDay =
    input.dayOfWeek === null ? null : clamp(input.dayOfWeek, 0, 6);

  switch (input.cadence) {
    case 'hourly':
      return computeHourlyRun(normalizedMinute, reference);
    case 'daily':
      return computeDailyRun(normalizedHour ?? 0, normalizedMinute, reference);
    case 'weekly':
      return computeWeeklyRun(
        normalizedDay ?? 0,
        normalizedHour ?? 0,
        normalizedMinute,
        reference,
      );
    default:
      return computeHourlyRun(normalizedMinute, reference);
  }
}

export function describeScheduledTask(input: ScheduledTaskTiming): string {
  const minute = input.minute.toString().padStart(2, '0');

  switch (input.cadence) {
    case 'hourly':
      return `Every hour at :${minute} UTC`;
    case 'daily':
      return `Every day at ${(input.hour ?? 0)
        .toString()
        .padStart(2, '0')}:${minute} UTC`;
    case 'weekly':
      return `Every ${WEEKDAY_LABELS[input.dayOfWeek ?? 0]} at ${(
        input.hour ?? 0
      )
        .toString()
        .padStart(2, '0')}:${minute} UTC`;
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

function computeHourlyRun(minute: number, from: Date): Date {
  const candidate = new Date(
    Date.UTC(
      from.getUTCFullYear(),
      from.getUTCMonth(),
      from.getUTCDate(),
      from.getUTCHours(),
      minute,
      0,
      0,
    ),
  );

  if (candidate.getTime() <= from.getTime()) {
    candidate.setUTCHours(candidate.getUTCHours() + 1);
  }

  return candidate;
}

function computeDailyRun(hour: number, minute: number, from: Date): Date {
  const candidate = new Date(
    Date.UTC(
      from.getUTCFullYear(),
      from.getUTCMonth(),
      from.getUTCDate(),
      hour,
      minute,
      0,
      0,
    ),
  );

  if (candidate.getTime() <= from.getTime()) {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }

  return candidate;
}

function computeWeeklyRun(
  dayOfWeek: number,
  hour: number,
  minute: number,
  from: Date,
): Date {
  const candidate = new Date(
    Date.UTC(
      from.getUTCFullYear(),
      from.getUTCMonth(),
      from.getUTCDate(),
      hour,
      minute,
      0,
      0,
    ),
  );

  const currentDay = from.getUTCDay();
  let dayOffset = dayOfWeek - currentDay;
  if (dayOffset < 0) {
    dayOffset += 7;
  }
  candidate.setUTCDate(candidate.getUTCDate() + dayOffset);

  if (candidate.getTime() <= from.getTime()) {
    candidate.setUTCDate(candidate.getUTCDate() + 7);
  }

  return candidate;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
