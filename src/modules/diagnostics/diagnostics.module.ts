import { Module } from '@nestjs/common';
import { AgentRealtimeModule } from '../agent-realtime/agent-realtime.module';
import { TasksModule } from '../tasks/tasks.module';
import { DiagnosticsController } from './diagnostics.controller';
import { DiagnosticsService } from './diagnostics.service';

@Module({
  imports: [TasksModule, AgentRealtimeModule],
  controllers: [DiagnosticsController],
  providers: [DiagnosticsService],
})
export class DiagnosticsModule {}
