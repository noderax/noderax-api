import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
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
import { PullAgentTasksResponseDto } from './dto/pull-agent-tasks-response.dto';
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
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Poll queued tasks for an agent',
    description:
      'Authenticates the agent and returns queued tasks for the specified node. The response body is wrapped as { tasks: [...] } for compatibility with the Go agent.',
  })
  @ApiBody({ type: PullAgentTasksDto })
  @ApiOkResponse({
    description: 'Queued tasks for the node.',
    type: PullAgentTasksResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid node ID or agent token.',
  })
  async pull(@Body() pullAgentTasksDto: PullAgentTasksDto) {
    return {
      tasks: await this.tasksService.pullQueuedForAgent(pullAgentTasksDto),
    };
  }

  @Post(':id/start')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark a queued task as running',
    description:
      'Authenticates the agent, verifies task ownership, and transitions a queued task to running.',
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
    description:
      'Persists agent output for a running task. Supports either a single message or batched entries from the Go agent.',
  })
  @ApiBody({ type: AppendTaskLogDto })
  @ApiCreatedResponse({
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
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark a task as completed, failed, or cancelled',
    description:
      'Stores terminal task state, optional execution result metadata, and emits realtime task updates.',
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
