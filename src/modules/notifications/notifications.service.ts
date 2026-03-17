import { Injectable, Logger } from '@nestjs/common';
import { EventEntity } from '../events/entities/event.entity';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  async notifyEvent(event: EventEntity) {
    this.logger.warn(
      `Notification stub triggered for ${event.severity} event ${event.type} on node ${event.nodeId ?? 'n/a'}`,
    );
  }
}
