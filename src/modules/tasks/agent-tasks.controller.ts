import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  ApiBody,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiHeader,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Response } from 'express';
import { CurrentAgent } from '../../common/decorators/current-agent.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { SWAGGER_BEARER_AUTH_NAME } from '../../common/constants/swagger.constants';
import { AgentAuthGuard } from '../../common/guards/agent-auth.guard';
import { AuthenticatedAgent } from '../../common/types/authenticated-agent.type';
import { AgentTaskAcceptedHttpDto } from './dto/agent-task-accepted-http.dto';
import {
  AgentTaskCompletedHttpDto,
  HTTP_TASK_OUTPUT_MAX_LENGTH,
} from './dto/agent-task-completed-http.dto';
import { AgentTaskControlResponseDto } from './dto/agent-task-control-response.dto';
import { AgentTaskLogHttpDto } from './dto/agent-task-log-http.dto';
import { AgentTaskStartedHttpDto } from './dto/agent-task-started-http.dto';
import { ClaimAgentTaskResponseDto } from './dto/claim-agent-task-response.dto';
import { ClaimAgentTasksDto } from './dto/claim-agent-tasks.dto';
import { TaskLogEntity } from './entities/task-log.entity';
import { TaskEntity } from './entities/task.entity';
import { TasksService } from './tasks.service';

@ApiTags('Agent Tasks')
@ApiBearerAuth(SWAGGER_BEARER_AUTH_NAME)
@ApiHeader({
  name: 'x-agent-node-id',
  required: true,
  description: 'Authenticated node id paired with bearer agent token.',
})
@Public()
@UseGuards(AgentAuthGuard)
@SkipThrottle()
@Controller('agent/tasks')
export class AgentTasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post('claim')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Claim next task for an agent',
    description:
      'Long-polls for the next claimable task and returns it with lease ownership metadata.',
  })
  @ApiBody({ type: ClaimAgentTasksDto })
  @ApiOkResponse({
    description: 'Task claimed.',
    type: ClaimAgentTaskResponseDto,
  })
  @ApiNoContentResponse({
    description: 'No task available in the requested polling window.',
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid agent authentication headers.',
  })
  async claim(
    @CurrentAgent() agent: AuthenticatedAgent,
    @Body() claimDto: ClaimAgentTasksDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ClaimAgentTaskResponseDto | void> {
    const claim = await this.tasksService.claimForAgent(agent, claimDto);
    if (!claim.task) {
      response.status(HttpStatus.NO_CONTENT);
      return;
    }

    return claim;
  }

  @Post(':taskId/accepted')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Accept claimed task',
    description: 'Idempotently records accepted transition for a claimed task.',
  })
  @ApiBody({ type: AgentTaskAcceptedHttpDto })
  @ApiOkResponse({
    description: 'Accepted transition recorded or treated as duplicate no-op.',
    type: TaskLogEntity,
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid agent authentication headers.',
  })
  @ApiNotFoundResponse({
    description: 'Task not found for this node.',
  })
  @ApiConflictResponse({
    description: 'Invalid state transition.',
  })
  accepted(
    @CurrentAgent() agent: AuthenticatedAgent,
    @Param('taskId') taskId: string,
    @Body() dto: AgentTaskAcceptedHttpDto,
  ) {
    return this.tasksService.acceptClaimedTaskForAgent(taskId, agent, dto);
  }

  @Get(':taskId/control')
  @ApiOperation({
    summary: 'Get control state for a running task',
    description:
      'Agent polls this endpoint while executing to detect operator requested cancellation.',
  })
  @ApiOkResponse({
    description: 'Current control state for this task.',
    type: AgentTaskControlResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid agent authentication headers.',
  })
  @ApiNotFoundResponse({
    description: 'Task not found for this node.',
  })
  control(
    @CurrentAgent() agent: AuthenticatedAgent,
    @Param('taskId') taskId: string,
  ) {
    return this.tasksService.getTaskControlForAgent(taskId, agent);
  }

  @Post(':taskId/started')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Start claimed task',
    description: 'Transitions claimed task to running state idempotently.',
  })
  @ApiBody({ type: AgentTaskStartedHttpDto })
  @ApiOkResponse({
    description: 'Task running transition accepted.',
    type: TaskEntity,
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid agent authentication headers.',
  })
  @ApiNotFoundResponse({
    description: 'Task not found for this node.',
  })
  @ApiConflictResponse({
    description: 'Invalid state transition.',
  })
  started(
    @CurrentAgent() agent: AuthenticatedAgent,
    @Param('taskId') taskId: string,
    @Body() dto: AgentTaskStartedHttpDto,
  ) {
    return this.tasksService.startClaimedTaskForAgent(taskId, agent, dto);
  }

  @Post(':taskId/logs')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Append a task log entry',
    description: 'Persists streamed task output for a running task.',
  })
  @ApiBody({ type: AgentTaskLogHttpDto })
  @ApiOkResponse({
    description: 'Task log entry stored.',
    type: TaskLogEntity,
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid agent authentication headers.',
  })
  @ApiNotFoundResponse({
    description: 'Task not found for this node.',
  })
  @ApiConflictResponse({
    description: 'Task is not in a loggable state.',
  })
  logs(
    @CurrentAgent() agent: AuthenticatedAgent,
    @Param('taskId') taskId: string,
    @Body() dto: AgentTaskLogHttpDto,
  ) {
    return this.tasksService.appendClaimedTaskLogForAgent(taskId, agent, dto);
  }

  @Post(':taskId/completed')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark a task as completed, failed, or cancelled',
    description: `Stores terminal task state idempotently. output is truncated to ${HTTP_TASK_OUTPUT_MAX_LENGTH} characters when required.`,
  })
  @ApiBody({ type: AgentTaskCompletedHttpDto })
  @ApiOkResponse({
    description: 'Task updated with a terminal status.',
    type: TaskEntity,
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid agent authentication headers.',
  })
  @ApiNotFoundResponse({
    description: 'Task not found for this node.',
  })
  @ApiConflictResponse({
    description: 'Invalid state transition.',
  })
  completed(
    @CurrentAgent() agent: AuthenticatedAgent,
    @Param('taskId') taskId: string,
    @Body() dto: AgentTaskCompletedHttpDto,
  ) {
    return this.tasksService.completeClaimedTaskForAgent(taskId, agent, dto);
  }
}
