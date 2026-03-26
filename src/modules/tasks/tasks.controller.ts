import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { SWAGGER_BEARER_AUTH_NAME } from '../../common/constants/swagger.constants';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../users/entities/user-role.enum';
import { CreateBatchTaskDto } from './dto/create-batch-task.dto';
import { CreateTaskDto } from './dto/create-task.dto';
import { QueryTaskLogsDto } from './dto/query-task-logs.dto';
import { QueryTasksDto } from './dto/query-tasks.dto';
import { RequestTaskCancelDto } from './dto/request-task-cancel.dto';
import { TaskLogEntity } from './entities/task-log.entity';
import { TaskEntity } from './entities/task.entity';
import { TasksService } from './tasks.service';

@ApiTags('Tasks')
@ApiBearerAuth(SWAGGER_BEARER_AUTH_NAME)
@ApiUnauthorizedResponse({
  description: 'JWT authentication required.',
})
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Create a task',
    description:
      'Queues a command or operation for a target node. Requires ADMIN role.',
  })
  @ApiCreatedResponse({
    description: 'Task created.',
    type: TaskEntity,
  })
  @ApiForbiddenResponse({
    description: 'Insufficient permissions.',
  })
  create(@Body() createTaskDto: CreateTaskDto) {
    return this.tasksService.create(createTaskDto);
  }

  @Post('batch')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Create tasks for multiple nodes',
    description:
      'Queues the same command or operation for multiple target nodes in one request. Requires ADMIN role.',
  })
  @ApiCreatedResponse({
    description: 'Tasks created.',
    type: TaskEntity,
    isArray: true,
  })
  @ApiForbiddenResponse({
    description: 'Insufficient permissions.',
  })
  createBatch(@Body() createBatchTaskDto: CreateBatchTaskDto) {
    return this.tasksService.createBatch(createBatchTaskDto);
  }

  @Get()
  @ApiOperation({
    summary: 'List tasks',
  })
  @ApiOkResponse({
    description: 'List of tasks.',
    type: TaskEntity,
    isArray: true,
  })
  findAll(@Query() query: QueryTasksDto) {
    return this.tasksService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get task by ID',
  })
  @ApiOkResponse({
    description: 'Task details.',
    type: TaskEntity,
  })
  @ApiNotFoundResponse({
    description: 'Task not found.',
  })
  findOne(@Param('id') id: string) {
    return this.tasksService.findOneOrFail(id);
  }

  @Get(':id/logs')
  @ApiOperation({
    summary: 'List task logs',
  })
  @ApiOkResponse({
    description: 'Chronological task log entries.',
    type: TaskLogEntity,
    isArray: true,
  })
  @ApiNotFoundResponse({
    description: 'Task not found.',
  })
  findLogs(@Param('id') id: string, @Query() query: QueryTaskLogsDto) {
    return this.tasksService.findLogs(id, query);
  }

  @Post(':id/cancel')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Request task cancellation',
    description:
      'Requests cancellation for an in-flight task. Running agents observe this via agent control polling.',
  })
  @ApiOkResponse({
    description: 'Task cancellation requested or already terminal.',
    type: TaskEntity,
  })
  @ApiForbiddenResponse({
    description: 'Insufficient permissions.',
  })
  @ApiNotFoundResponse({
    description: 'Task not found.',
  })
  cancel(@Param('id') id: string, @Body() dto: RequestTaskCancelDto) {
    return this.tasksService.requestTaskCancellation(id, dto);
  }
}
