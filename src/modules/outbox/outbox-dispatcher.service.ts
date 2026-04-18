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
          await this.dispatchEvent(event);
          await this.outboxService.markDelivered(event.id);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.error(
            `Outbox dispatch failed for ${event.type} (${event.id}): ${message}`,
          );
          await this.outboxService.markFailed(event, message);
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
        this.logger.warn(`Ignoring unknown outbox event type ${event.type}`);
    }
  }

  private async dispatchCreatedEvent(payload: Record<string, unknown>) {
    const event = this.hydrateEvent(payload.event as Record<string, unknown>);
    this.realtimeGateway.emitEventCreated(
      payload.event as Record<string, unknown>,
    );
    await this.redisService.publish(PUBSUB_CHANNELS.EVENTS_CREATED, {
      eventId: event.id,
      nodeId: event.nodeId,
      type: event.type,
      severity: event.severity,
    });
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
    this.realtimeGateway.emitTaskCreated(
      payload.task as Record<string, unknown>,
    );
    await this.redisService.publish(
      PUBSUB_CHANNELS.TASKS_CREATED,
      this.asPayload(payload.redis),
    );
  }

  private async dispatchTaskUpdated(payload: Record<string, unknown>) {
    this.realtimeGateway.emitTaskUpdated(
      payload.task as Record<string, unknown>,
    );
    await this.redisService.publish(
      PUBSUB_CHANNELS.TASKS_UPDATED,
      this.asPayload(payload.redis),
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
}
