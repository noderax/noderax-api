import { Module } from '@nestjs/common';
import { NodesModule } from '../nodes/nodes.module';
import { TasksModule } from '../tasks/tasks.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { LogsService } from './logs.service';
import { WorkspaceNodeLogsController } from './workspace-node-logs.controller';

@Module({
  imports: [NodesModule, TasksModule, WorkspacesModule],
  controllers: [WorkspaceNodeLogsController],
  providers: [LogsService],
  exports: [LogsService],
})
export class LogsModule {}
