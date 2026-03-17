import { Body, Controller, Param, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { AppendTaskLogDto } from './dto/append-task-log.dto';
import { CompleteAgentTaskDto } from './dto/complete-agent-task.dto';
import { PullAgentTasksDto } from './dto/pull-agent-tasks.dto';
import { StartAgentTaskDto } from './dto/start-agent-task.dto';
import { TaskLogEntity } from './entities/task-log.entity';
import { TaskEntity } from './entities/task.entity';
import { TasksService } from './tasks.service';

@ApiTags('Agent Tasks')
@Public()
@Controller('agent/tasks')
export class AgentTasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post('pull')
  @ApiOperation({
    summary: 'Poll queued tasks for an agent',
    description:
      'Authenticates the agent and returns queued tasks for the specified node.',
  })
  @ApiBody({ type: PullAgentTasksDto })
  @ApiOkResponse({
    description: 'Queued tasks for the node.',
    type: TaskEntity,
    isArray: true,
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid node ID or agent token.',
  })
  pull(@Body() pullAgentTasksDto: PullAgentTasksDto) {
    return this.tasksService.pullQueuedForAgent(pullAgentTasksDto);
  }

  @Post(':id/start')
  @ApiOperation({
    summary: 'Mark a queued task as running',
  })
  @ApiBody({ type: StartAgentTaskDto })
  @ApiOkResponse({
    description: 'Task marked as running.',
    type: TaskEntity,
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid node ID or agent token.',
  })
  @ApiNotFoundResponse({
    description: 'Task not found for this node.',
  })
  @ApiConflictResponse({
    description: 'Task is already completed or cancelled.',
  })
  start(@Param('id') id: string, @Body() startAgentTaskDto: StartAgentTaskDto) {
    return this.tasksService.startForAgent(id, startAgentTaskDto);
  }

  @Post(':id/logs')
  @ApiOperation({
    summary: 'Append a task log entry',
  })
  @ApiBody({ type: AppendTaskLogDto })
  @ApiOkResponse({
    description: 'Task log entry stored.',
    type: TaskLogEntity,
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid node ID or agent token.',
  })
  @ApiNotFoundResponse({
    description: 'Task not found for this node.',
  })
  @ApiConflictResponse({
    description: 'Task is not in a loggable state.',
  })
  appendLog(
    @Param('id') id: string,
    @Body() appendTaskLogDto: AppendTaskLogDto,
  ) {
    return this.tasksService.appendLogForAgent(id, appendTaskLogDto);
  }

  @Post(':id/complete')
  @ApiOperation({
    summary: 'Mark a task as completed, failed, or cancelled',
  })
  @ApiBody({ type: CompleteAgentTaskDto })
  @ApiOkResponse({
    description: 'Task updated with a terminal status.',
    type: TaskEntity,
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid node ID or agent token.',
  })
  @ApiNotFoundResponse({
    description: 'Task not found for this node.',
  })
  @ApiConflictResponse({
    description: 'Task is already in a terminal state.',
  })
  complete(
    @Param('id') id: string,
    @Body() completeAgentTaskDto: CompleteAgentTaskDto,
  ) {
    return this.tasksService.completeForAgent(id, completeAgentTaskDto);
  }
}
