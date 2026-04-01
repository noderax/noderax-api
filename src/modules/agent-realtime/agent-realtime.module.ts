import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentUpdatesModule } from '../agent-updates/agent-updates.module';
import { MetricsModule } from '../metrics/metrics.module';
import { NodesModule } from '../nodes/nodes.module';
import { TasksModule } from '../tasks/tasks.module';
import { TerminalSessionsModule } from '../terminal-sessions/terminal-sessions.module';
import { AgentRealtimeGateway } from './agent-realtime.gateway';
import { AgentRealtimeService } from './agent-realtime.service';
import { AgentTaskLifecycleEventEntity } from './entities/agent-task-lifecycle-event.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([AgentTaskLifecycleEventEntity]),
    NodesModule,
    MetricsModule,
    forwardRef(() => AgentUpdatesModule),
    forwardRef(() => TasksModule),
    forwardRef(() => TerminalSessionsModule),
  ],
  providers: [AgentRealtimeGateway, AgentRealtimeService],
  exports: [AgentRealtimeService],
})
export class AgentRealtimeModule {}
