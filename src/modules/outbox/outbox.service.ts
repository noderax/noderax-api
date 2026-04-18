import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { hostname } from 'os';
import { randomUUID } from 'crypto';
import { OutboxEventEntity } from './entities/outbox-event.entity';

export type EnqueueOutboxEventInput = {
  type: string;
  payload: Record<string, unknown>;
  availableAt?: Date;
  maxAttempts?: number;
};

export type ClaimedOutboxEvent = OutboxEventEntity;

@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);
  private readonly workerId = `${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;

  constructor(
    @InjectRepository(OutboxEventEntity)
    private readonly outboxRepository: Repository<OutboxEventEntity>,
    private readonly dataSource: DataSource,
  ) {}

  getWorkerId(): string {
    return this.workerId;
  }

  async enqueue(input: EnqueueOutboxEventInput): Promise<OutboxEventEntity> {
    const event = this.outboxRepository.create({
      type: input.type,
      payload: input.payload,
      status: 'pending',
      attempts: 0,
      maxAttempts: input.maxAttempts ?? 8,
      availableAt: input.availableAt ?? new Date(),
      lockedAt: null,
      lockedBy: null,
      processedAt: null,
      lastError: null,
    });

    return this.outboxRepository.save(event);
  }

  async claimDueBatch(limit: number): Promise<ClaimedOutboxEvent[]> {
    if (limit <= 0) {
      return [];
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const rows = (await queryRunner.query(
        `
          WITH due AS (
            SELECT "id"
            FROM "outbox_events"
            WHERE (
              "status" IN ('pending', 'failed')
              AND "availableAt" <= now()
            ) OR (
                "status" = 'processing'
                AND "lockedAt" IS NOT NULL
                AND "lockedAt" <= now() - interval '2 minutes'
              )
            ORDER BY "availableAt" ASC, "createdAt" ASC
            LIMIT $1
            FOR UPDATE SKIP LOCKED
          )
          UPDATE "outbox_events" "outbox"
          SET
            "status" = 'processing',
            "attempts" = "outbox"."attempts" + 1,
            "lockedAt" = now(),
            "lockedBy" = $2,
            "updatedAt" = now()
          FROM due
          WHERE "outbox"."id" = due."id"
          RETURNING
            "outbox"."id" AS "id",
            "outbox"."type" AS "type",
            "outbox"."attempts" AS "attempts",
            "outbox"."maxAttempts" AS "maxAttempts"
        `,
        [limit, this.workerId],
      )) as Array<Record<string, unknown>>;

      await queryRunner.commitTransaction();

      const claimedIds = rows
        .map((row) => {
          if (typeof row.id === 'string' && row.id.length > 0) {
            return row.id;
          }

          if (typeof row.outbox_id === 'string' && row.outbox_id.length > 0) {
            return row.outbox_id;
          }

          this.logger.warn(
            `Claimed outbox row missing id after lock acquisition: ${JSON.stringify(row)}`,
          );
          return null;
        })
        .filter((value): value is string => typeof value === 'string');

      if (claimedIds.length === 0) {
        if (rows.length > 0) {
          this.logger.warn(
            `Discarded ${rows.length} claimed outbox rows because no valid ids were returned`,
          );
        }
        return [];
      }

      const claimedEvents = await this.outboxRepository.find({
        where: { id: In(claimedIds) },
      });
      const claimedEventsById = new Map(
        claimedEvents.map((event) => [event.id, event]),
      );

      return claimedIds
        .map((id) => {
          const event = claimedEventsById.get(id);
          if (!event) {
            this.logger.warn(
              `Claimed outbox event ${id} could not be reloaded after lock acquisition`,
            );
            return null;
          }

          return event;
        })
        .filter((event): event is ClaimedOutboxEvent => event !== null);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async markDelivered(id: string): Promise<void> {
    await this.outboxRepository.update(id, {
      status: 'delivered',
      processedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      lastError: null,
    });
  }

  async markFailed(
    event: Pick<OutboxEventEntity, 'id' | 'attempts' | 'maxAttempts'>,
    errorMessage: string,
  ): Promise<void> {
    if (!event.id) {
      throw new Error('Cannot mark outbox event as failed without an id');
    }

    const deadLetter = event.attempts >= event.maxAttempts;
    const retryDelayMs = Math.min(
      60_000,
      2 ** Math.min(event.attempts, 6) * 1_000,
    );

    await this.outboxRepository.update(event.id, {
      status: deadLetter ? 'dead_letter' : 'failed',
      availableAt: deadLetter
        ? new Date()
        : new Date(Date.now() + retryDelayMs),
      lockedAt: null,
      lockedBy: null,
      processedAt: deadLetter ? new Date() : null,
      lastError: errorMessage,
    });
  }

  async getOperationalSnapshot() {
    const [backlogCount, dueCount, failedCount, deadLetterCount] =
      await Promise.all([
        this.outboxRepository.count({
          where: [
            { status: 'pending' },
            { status: 'failed' },
            { status: 'processing' },
          ],
        }),
        this.outboxRepository
          .createQueryBuilder('outbox')
          .where('outbox.status IN (:...statuses)', {
            statuses: ['pending', 'failed'],
          })
          .andWhere('outbox.availableAt <= :now', { now: new Date() })
          .getCount(),
        this.outboxRepository.count({
          where: { status: 'failed' },
        }),
        this.outboxRepository.count({
          where: { status: 'dead_letter' },
        }),
      ]);

    return {
      workerId: this.workerId,
      backlogCount,
      dueCount,
      failedCount,
      deadLetterCount,
    };
  }
}
