import { AppService } from './app.service';

describe('AppService readiness', () => {
  it('marks outbox as unhealthy and exposes dead-letter metadata', async () => {
    const outboxService = {
      getOperationalSnapshot: jest.fn().mockResolvedValue({
        workerId: 'worker-1',
        backlogCount: 2,
        dueCount: 0,
        failedCount: 0,
        deadLetterCount: 2,
        deadLetters: [
          {
            id: 'outbox-1',
            type: 'event.created',
            attempts: 8,
            lastError: 'mailer failed',
            updatedAt: '2026-04-19T12:17:17.451Z',
          },
        ],
      }),
    };

    const service = new AppService(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      outboxService as never,
    );

    const readiness = await service.getReadiness();

    expect(readiness.ready).toBe(false);
    expect(readiness.checks.outbox.healthy).toBe(false);
    expect(readiness.checks.outbox.status).toBe('dead_letter');
    expect(readiness.checks.outbox.meta).toEqual(
      expect.objectContaining({
        deadLetterCount: 2,
        deadLetters: [
          expect.objectContaining({
            id: 'outbox-1',
            type: 'event.created',
          }),
        ],
        actions: [
          { id: 'requeue', label: 'Requeue failed events' },
          { id: 'delete', label: 'Delete dead-letter events' },
        ],
      }),
    );
  });
});
