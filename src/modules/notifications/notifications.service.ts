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

  async notifyEnrollmentInitiated(input: {
    email: string;
    hostname: string;
    expiresAt: Date;
    hasKnownUser: boolean;
  }) {
    this.logger.warn(
      `Enrollment notification stub for ${input.email} (${input.hostname}) expiring at ${input.expiresAt.toISOString()} - known user: ${input.hasKnownUser}`,
    );
  }
}
