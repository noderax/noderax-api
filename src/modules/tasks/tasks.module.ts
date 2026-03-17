import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventsModule } from '../events/events.module';
import { NodesModule } from '../nodes/nodes.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { AgentTasksController } from './agent-tasks.controller';
import { TaskSchemaBootstrap } from './bootstrap/task-schema.bootstrap';
import { TaskLogEntity } from './entities/task-log.entity';
import { TaskEntity } from './entities/task.entity';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([TaskEntity, TaskLogEntity]),
    NodesModule,
    EventsModule,
    RealtimeModule,
  ],
  controllers: [TasksController, AgentTasksController],
  providers: [TasksService, TaskSchemaBootstrap],
  exports: [TasksService],
})
export class TasksModule {}
