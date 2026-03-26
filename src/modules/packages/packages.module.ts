import { Module } from '@nestjs/common';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { TasksModule } from '../tasks/tasks.module';
import { PackagesController } from './packages.controller';
import { PackagesService } from './packages.service';
import { WorkspacePackagesController } from './workspace-packages.controller';

@Module({
  imports: [TasksModule, WorkspacesModule],
  controllers: [PackagesController, WorkspacePackagesController],
  providers: [PackagesService],
})
export class PackagesModule {}
