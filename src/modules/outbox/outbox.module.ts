import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsModule } from '../notifications/notifications.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { RedisModule } from '../../redis/redis.module';
import { OutboxController } from './outbox.controller';
import { OutboxEventEntity } from './entities/outbox-event.entity';
import { OutboxDispatcherService } from './outbox-dispatcher.service';
import { OutboxService } from './outbox.service';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([OutboxEventEntity]),
    NotificationsModule,
    RealtimeModule,
    RedisModule,
  ],
  controllers: [OutboxController],
  providers: [OutboxService, OutboxDispatcherService],
  exports: [OutboxService],
})
export class OutboxModule {}
