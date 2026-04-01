import { Module } from '@nestjs/common';
import { AgentUpdatesModule } from '../agent-updates/agent-updates.module';
import { EventsModule } from '../events/events.module';
import { NodesModule } from '../nodes/nodes.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';

@Module({
  imports: [NodesModule, EventsModule, RealtimeModule, AgentUpdatesModule],
  controllers: [AgentsController],
  providers: [AgentsService],
  exports: [AgentsService],
})
export class AgentsModule {}
