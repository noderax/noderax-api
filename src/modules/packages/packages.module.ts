import { Module } from '@nestjs/common';
import { TasksModule } from '../tasks/tasks.module';
import { PackagesController } from './packages.controller';
import { PackagesService } from './packages.service';

@Module({
  imports: [TasksModule],
  controllers: [PackagesController],
  providers: [PackagesService],
})
export class PackagesModule {}
