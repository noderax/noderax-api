import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PUBSUB_CHANNELS } from '../../common/constants/pubsub.constants';
import { RedisService } from '../../redis/redis.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { EventEntity } from '../events/entities/event.entity';
import { OutboxEventEntity } from './entities/outbox-event.entity';
import { OutboxService } from './outbox.service';

const OUTBOX_BATCH_LIMIT = 25;

@Injectable()
export class OutboxDispatcherService implements OnModuleInit {
  private readonly logger = new Logger(OutboxDispatcherService.name);

  constructor(
    private readonly outboxService: OutboxService,
    private readonly realtimeGateway: RealtimeGateway,
    private readonly redisService: RedisService,
    private readonly notificationsService: NotificationsService,
  ) {}

  onModuleInit(): void {
    this.logger.log(
      `Outbox dispatcher active with worker ${this.outboxService.getWorkerId()}`,
    );
  }

  @Interval('outbox-dispatch', 2_000)
  async dispatchDueEvents(): Promise<void> {
    while (true) {
      const batch = await this.outboxService.claimDueBatch(OUTBOX_BATCH_LIMIT);
      if (batch.length === 0) {
        return;
      }

      for (const event of batch) {
        try {
          this.assertClaimedEvent(event);
          await this.dispatchEvent(event);
          await this.outboxService.markDelivered(event.id);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          const eventType =
            typeof event?.type === 'string' ? event.type : '<unknown>';
          const eventId =
            typeof event?.id === 'string' ? event.id : '<unknown>';

          this.logger.error(
            `Outbox dispatch failed for ${eventType} (${eventId}): ${message}`,
          );

          if (this.canMarkFailed(event)) {
            await this.outboxService.markFailed(event, message);
            continue;
          }

          this.logger.error(
            `Skipping markFailed for malformed outbox event payload ${eventId}`,
          );
        }
      }
    }
  }

  private async dispatchEvent(event: OutboxEventEntity): Promise<void> {
    switch (event.type) {
      case 'event.created':
        await this.dispatchCreatedEvent(event.payload);
        return;
      case 'metric.ingested':
        await this.dispatchMetricIngested(event.payload);
        return;
      case 'node.status-updated':
        await this.dispatchNodeStatusUpdated(event.payload);
        return;
      case 'node.root-access-updated':
        await this.dispatchNodeRootAccessUpdated(event.payload);
        return;
      case 'task.created':
        await this.dispatchTaskCreated(event.payload);
        return;
      case 'task.updated':
        await this.dispatchTaskUpdated(event.payload);
        return;
      case 'node-install.updated':
        await this.dispatchNodeInstallUpdated(event.payload);
        return;
      default:
        throw new Error(`Unknown outbox event type ${String(event.type)}`);
    }
  }

  private async dispatchCreatedEvent(payload: Record<string, unknown>) {
    const event = this.hydrateEvent(payload.event as Record<string, unknown>);
    const realtimePayload = this.asPayload(payload.event);
    this.realtimeGateway.emitEventCreated(realtimePayload);
    await this.redisService.publish(
      PUBSUB_CHANNELS.EVENTS_CREATED,
      realtimePayload,
    );
    await this.notificationsService.notifyEvent(event, {
      propagateErrors: true,
    });
  }

  private async dispatchMetricIngested(payload: Record<string, unknown>) {
    this.realtimeGateway.emitMetricIngested(
      payload.metric as Record<string, unknown>,
    );
    await this.redisService.publish(
      PUBSUB_CHANNELS.METRICS_INGESTED,
      payload.metric as Record<string, unknown>,
    );
  }

  private async dispatchNodeStatusUpdated(payload: Record<string, unknown>) {
    this.realtimeGateway.emitNodeStatusUpdate(payload);
    await this.redisService.publish(
      PUBSUB_CHANNELS.NODES_STATUS_UPDATED,
      payload,
    );
  }

  private async dispatchNodeRootAccessUpdated(
    payload: Record<string, unknown>,
  ) {
    this.realtimeGateway.emitNodeRootAccessUpdate(payload);
    await this.redisService.publish(
      PUBSUB_CHANNELS.NODES_ROOT_ACCESS_UPDATED,
      payload,
    );
  }

  private async dispatchTaskCreated(payload: Record<string, unknown>) {
    const realtimePayload = this.asPayload(payload.task);
    this.realtimeGateway.emitTaskCreated(realtimePayload);
    await this.redisService.publish(
      PUBSUB_CHANNELS.TASKS_CREATED,
      realtimePayload,
    );
  }

  private async dispatchTaskUpdated(payload: Record<string, unknown>) {
    const realtimePayload = this.asPayload(payload.task);
    this.realtimeGateway.emitTaskUpdated(realtimePayload);
    await this.redisService.publish(
      PUBSUB_CHANNELS.TASKS_UPDATED,
      realtimePayload,
    );
  }

  private async dispatchNodeInstallUpdated(payload: Record<string, unknown>) {
    this.realtimeGateway.emitNodeInstallUpdated(
      payload.nodeInstall as Record<string, unknown>,
    );
    await this.redisService.publish(
      PUBSUB_CHANNELS.NODE_INSTALLS_UPDATED,
      this.asPayload(payload.redis),
    );
  }

  private hydrateEvent(payload: Record<string, unknown>): EventEntity {
    return {
      ...(payload as unknown as EventEntity),
      createdAt:
        payload.createdAt instanceof Date
          ? payload.createdAt
          : new Date(String(payload.createdAt)),
    } as EventEntity;
  }

  private asPayload(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }

    return {};
  }

  private assertClaimedEvent(
    event: OutboxEventEntity | null | undefined,
  ): asserts event is OutboxEventEntity {
    if (
      !event ||
      typeof event.id !== 'string' ||
      event.id.length === 0 ||
      typeof event.type !== 'string' ||
      event.type.length === 0 ||
      !event.payload ||
      typeof event.payload !== 'object' ||
      Array.isArray(event.payload)
    ) {
      throw new Error('Malformed outbox event claimed for dispatch');
    }
  }

  private canMarkFailed(
    event: Partial<Pick<OutboxEventEntity, 'id' | 'attempts' | 'maxAttempts'>>,
  ): event is Pick<OutboxEventEntity, 'id' | 'attempts' | 'maxAttempts'> {
    return (
      typeof event?.id === 'string' &&
      event.id.length > 0 &&
      typeof event.attempts === 'number' &&
      typeof event.maxAttempts === 'number'
    );
  }
}
