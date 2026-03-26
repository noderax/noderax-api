import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NodeEntity } from '../nodes/entities/node.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { EventEntity } from './entities/event.entity';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { WorkspaceEventsController } from './workspace-events.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([EventEntity, NodeEntity]),
    NotificationsModule,
    RealtimeModule,
    WorkspacesModule,
  ],
  controllers: [EventsController, WorkspaceEventsController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
