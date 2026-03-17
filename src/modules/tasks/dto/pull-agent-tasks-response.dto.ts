import { ApiProperty } from '@nestjs/swagger';
import { TaskEntity } from '../entities/task.entity';

export class PullAgentTasksResponseDto {
  @ApiProperty({
    type: TaskEntity,
    isArray: true,
  })
  tasks: TaskEntity[];
}
