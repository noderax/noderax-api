import { DataSource, Repository } from 'typeorm';
import { OutboxEventEntity } from './entities/outbox-event.entity';
import { OutboxService } from './outbox.service';

describe('OutboxService', () => {
  let outboxRepository: jest.Mocked<Repository<OutboxEventEntity>>;
  let queryRunner: {
    connect: jest.Mock;
    startTransaction: jest.Mock;
    query: jest.Mock;
    commitTransaction: jest.Mock;
    rollbackTransaction: jest.Mock;
    release: jest.Mock;
  };
  let dataSource: jest.Mocked<DataSource>;
  let service: OutboxService;

  beforeEach(() => {
    outboxRepository = {
      find: jest.fn(),
      count: jest.fn(),
      delete: jest.fn(),
      update: jest.fn(),
      createQueryBuilder: jest.fn(),
    } as unknown as jest.Mocked<Repository<OutboxEventEntity>>;

    queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      query: jest.fn(),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
    };

    dataSource = {
      createQueryRunner: jest.fn().mockReturnValue(queryRunner),
    } as unknown as jest.Mocked<DataSource>;

    service = new OutboxService(outboxRepository, dataSource);
  });

  it('reloads claimed outbox events through the repository after lock acquisition', async () => {
    queryRunner.query.mockResolvedValue([
      { id: 'outbox-1' },
      { id: 'outbox-2' },
    ]);
    outboxRepository.find.mockResolvedValue([
      {
        id: 'outbox-2',
        type: 'task.updated',
        payload: { task: { id: 'task-2' } },
      },
      {
        id: 'outbox-1',
        type: 'event.created',
        payload: { event: { id: 'event-1' } },
      },
    ] as never);

    const claimed = await service.claimDueBatch(25);

    expect(outboxRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.any(Object),
      }),
    );
    expect(claimed.map((event) => event.id)).toEqual(['outbox-1', 'outbox-2']);
    expect(claimed.map((event) => event.type)).toEqual([
      'event.created',
      'task.updated',
    ]);
  });

  it('supports tuple-shaped raw query results returned by the driver', async () => {
    queryRunner.query.mockResolvedValue([
      [{ id: 'outbox-1' }, { id: 'outbox-2' }],
      2,
    ]);
    outboxRepository.find.mockResolvedValue([
      {
        id: 'outbox-1',
        type: 'event.created',
        payload: { event: { id: 'event-1' } },
      },
      {
        id: 'outbox-2',
        type: 'task.updated',
        payload: { task: { id: 'task-2' } },
      },
    ] as never);

    const claimed = await service.claimDueBatch(25);

    expect(claimed.map((event) => event.id)).toEqual(['outbox-1', 'outbox-2']);
  });

  it('rejects markFailed when the outbox event id is missing', async () => {
    await expect(
      service.markFailed(
        {
          id: '' as string,
          attempts: 1,
          maxAttempts: 8,
        },
        'broken',
      ),
    ).rejects.toThrow('Cannot mark outbox event as failed without an id');
    expect(outboxRepository.update).not.toHaveBeenCalled();
  });

  it('includes dead-letter preview records in the operational snapshot', async () => {
    const queryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(1),
    };
    outboxRepository.count
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(1);
    outboxRepository.createQueryBuilder.mockReturnValue(queryBuilder as never);
    outboxRepository.find.mockResolvedValueOnce([
      {
        id: 'outbox-1',
        type: 'event.created',
        attempts: 8,
        lastError: 'boom',
        updatedAt: new Date('2026-04-19T12:17:17.451Z'),
      },
    ] as never);

    const snapshot = await service.getOperationalSnapshot();

    expect(snapshot.deadLetterCount).toBe(1);
    expect(snapshot.deadLetters).toEqual([
      {
        id: 'outbox-1',
        type: 'event.created',
        attempts: 8,
        lastError: 'boom',
        updatedAt: '2026-04-19T12:17:17.451Z',
      },
    ]);
  });

  it('requeues eligible dead-letter event notifications', async () => {
    outboxRepository.find.mockResolvedValueOnce([
      {
        id: 'outbox-1',
        status: 'dead_letter',
        type: 'event.created',
      },
    ] as never);
    outboxRepository.update.mockResolvedValue({ affected: 1 } as never);

    const affected = await service.requeueDeadLetters(['outbox-1']);

    expect(affected).toBe(1);
    expect(outboxRepository.update).toHaveBeenCalled();
  });

  it('rejects web remediation for unsupported dead-letter ids', async () => {
    outboxRepository.find.mockResolvedValueOnce([] as never);

    await expect(service.deleteDeadLetters(['outbox-1'])).rejects.toThrow(
      'Only dead-letter event.created outbox entries may be remediated from the web UI.',
    );
    expect(outboxRepository.delete).not.toHaveBeenCalled();
  });
});
