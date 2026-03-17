import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PUBSUB_CHANNELS } from '../../common/constants/pubsub.constants';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { RedisService } from '../../redis/redis.service';
import { QueryEventsDto } from './dto/query-events.dto';
import { EventEntity } from './entities/event.entity';
import { EventSeverity } from './entities/event-severity.enum';

@Injectable()
export class EventsService {
  constructor(
    @InjectRepository(EventEntity)
    private readonly eventsRepository: Repository<EventEntity>,
    private readonly notificationsService: NotificationsService,
    private readonly realtimeGateway: RealtimeGateway,
    private readonly redisService: RedisService,
  ) {}

  async record(input: {
    nodeId?: string | null;
    type: string;
    severity?: EventSeverity;
    message: string;
    metadata?: Record<string, unknown>;
  }) {
    const event = this.eventsRepository.create({
      nodeId: input.nodeId ?? null,
      type: input.type,
      severity: input.severity ?? EventSeverity.INFO,
      message: input.message,
      metadata: input.metadata ?? null,
    });

    const savedEvent = await this.eventsRepository.save(event);

    this.realtimeGateway.emitEventCreated(
      savedEvent as unknown as Record<string, unknown>,
    );
    await this.redisService.publish(PUBSUB_CHANNELS.EVENTS_CREATED, {
      eventId: savedEvent.id,
      nodeId: savedEvent.nodeId,
      type: savedEvent.type,
      severity: savedEvent.severity,
    });

    if (savedEvent.severity === EventSeverity.CRITICAL) {
      await this.notificationsService.notifyEvent(savedEvent);
    }

    return savedEvent;
  }

  async findAll(query: QueryEventsDto) {
    const eventsQuery = this.eventsRepository
      .createQueryBuilder('event')
      .orderBy('event.createdAt', 'DESC')
      .take(query.limit ?? 50);

    if (query.nodeId) {
      eventsQuery.andWhere('event.nodeId = :nodeId', { nodeId: query.nodeId });
    }

    if (query.type) {
      eventsQuery.andWhere('event.type = :type', { type: query.type });
    }

    if (query.severity) {
      eventsQuery.andWhere('event.severity = :severity', {
        severity: query.severity,
      });
    }

    return eventsQuery.getMany();
  }
}
