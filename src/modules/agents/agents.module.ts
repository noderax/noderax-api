import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { NodesModule } from '../nodes/nodes.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';

@Module({
  imports: [NodesModule, EventsModule, RealtimeModule],
  controllers: [AgentsController],
  providers: [AgentsService],
  exports: [AgentsService],
})
export class AgentsModule {}
