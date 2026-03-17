import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CreateTaskDto } from './dto/create-task.dto';
import { QueryTasksDto } from './dto/query-tasks.dto';
import { TaskEntity } from './entities/task.entity';
import { TasksService } from './tasks.service';

@ApiTags('Tasks')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({
  description: 'JWT authentication required.',
})
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a task',
    description: 'Queues a command or operation for a target node.',
  })
  @ApiCreatedResponse({
    description: 'Task created.',
    type: TaskEntity,
  })
  create(@Body() createTaskDto: CreateTaskDto) {
    return this.tasksService.create(createTaskDto);
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
}
