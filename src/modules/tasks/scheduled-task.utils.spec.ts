import { computeNextScheduledRun } from './scheduled-task.utils';

describe('computeNextScheduledRun', () => {
  it('advances hourly schedules without drift', () => {
    const nextRun = computeNextScheduledRun(
      {
        cadence: 'hourly',
        minute: 15,
        hour: null,
        dayOfWeek: null,
      },
      new Date('2026-03-26T10:15:20.000Z'),
    );

    expect(nextRun.toISOString()).toBe('2026-03-26T11:15:00.000Z');
  });

  it('advances daily schedules to the next day when the slot already passed', () => {
    const nextRun = computeNextScheduledRun(
      {
        cadence: 'daily',
        minute: 0,
        hour: 10,
        dayOfWeek: null,
      },
      new Date('2026-03-26T10:00:00.000Z'),
    );

    expect(nextRun.toISOString()).toBe('2026-03-27T10:00:00.000Z');
  });

  it('advances weekly schedules to the next matching weekday', () => {
    const nextRun = computeNextScheduledRun(
      {
        cadence: 'weekly',
        minute: 30,
        hour: 9,
        dayOfWeek: 4,
      },
      new Date('2026-03-26T09:31:00.000Z'),
    );

    expect(nextRun.toISOString()).toBe('2026-04-02T09:30:00.000Z');
  });
});
