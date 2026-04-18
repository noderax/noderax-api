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
      update: jest.fn(),
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
});
