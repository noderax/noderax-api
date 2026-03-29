import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PUBSUB_CHANNELS } from '../../common/constants/pubsub.constants';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { RedisService } from '../../redis/redis.service';
import { NodeEntity } from '../nodes/entities/node.entity';
import { QueryEventsDto } from './dto/query-events.dto';
import { EventEntity } from './entities/event.entity';
import { EventSeverity } from './entities/event-severity.enum';

@Injectable()
export class EventsService {
  constructor(
    @InjectRepository(EventEntity)
    private readonly eventsRepository: Repository<EventEntity>,
    @InjectRepository(NodeEntity)
    private readonly nodesRepository: Repository<NodeEntity>,
    private readonly notificationsService: NotificationsService,
    private readonly realtimeGateway: RealtimeGateway,
    private readonly redisService: RedisService,
  ) {}

  async record(input: {
    workspaceId?: string;
    nodeId?: string | null;
    type: string;
    severity?: EventSeverity;
    message: string;
    metadata?: Record<string, unknown>;
  }) {
    const resolvedWorkspaceId =
      input.workspaceId ??
      (input.nodeId
        ? (
            await this.nodesRepository.findOne({
              where: { id: input.nodeId },
              select: ['workspaceId'],
            })
          )?.workspaceId
        : null);

    if (!resolvedWorkspaceId) {
      throw new Error(
        `Workspace context could not be resolved for event ${input.type}`,
      );
    }

    const event = this.eventsRepository.create({
      workspaceId: resolvedWorkspaceId,
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

    await this.notificationsService.notifyEvent(savedEvent);

    return savedEvent;
  }

  async findAll(query: QueryEventsDto, workspaceId?: string) {
    const eventsQuery = this.eventsRepository
      .createQueryBuilder('event')
      .orderBy('event.createdAt', 'DESC')
      .take(query.limit ?? 50);

    if (workspaceId) {
      eventsQuery.andWhere('event.workspaceId = :workspaceId', { workspaceId });
    }

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
