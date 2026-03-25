import { computeNextScheduledRun } from './scheduled-task.utils';

describe('computeNextScheduledRun', () => {
  it('advances hourly schedules without drift across DST jumps', () => {
    const nextRun = computeNextScheduledRun(
      {
        cadence: 'hourly',
        minute: 15,
        hour: null,
        dayOfWeek: null,
        timezone: 'America/New_York',
      },
      new Date('2026-03-08T06:15:00.000Z'),
    );

    expect(nextRun.toISOString()).toBe('2026-03-08T07:15:00.000Z');
  });

  it('keeps daily schedules pinned to the same local hour after DST changes', () => {
    const nextRun = computeNextScheduledRun(
      {
        cadence: 'daily',
        minute: 0,
        hour: 9,
        dayOfWeek: null,
        timezone: 'America/New_York',
      },
      new Date('2026-03-07T14:00:00.000Z'),
    );

    expect(nextRun.toISOString()).toBe('2026-03-08T13:00:00.000Z');
  });

  it('advances weekly schedules to the next matching weekday in the target timezone', () => {
    const nextRun = computeNextScheduledRun(
      {
        cadence: 'weekly',
        minute: 30,
        hour: 9,
        dayOfWeek: 1,
        timezone: 'Europe/Istanbul',
      },
      new Date('2026-03-26T09:31:00.000Z'),
    );

    expect(nextRun.toISOString()).toBe('2026-03-30T06:30:00.000Z');
  });
});
