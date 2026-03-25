import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { SWAGGER_BEARER_AUTH_NAME } from '../../common/constants/swagger.constants';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../users/entities/user-role.enum';
import { CreateScheduledTaskDto } from './dto/create-scheduled-task.dto';
import { UpdateScheduledTaskDto } from './dto/update-scheduled-task.dto';
import { ScheduledTaskEntity } from './entities/scheduled-task.entity';
import { ScheduledTasksService } from './scheduled-tasks.service';

@ApiTags('Scheduled Tasks')
@ApiBearerAuth(SWAGGER_BEARER_AUTH_NAME)
@ApiUnauthorizedResponse({
  description: 'JWT authentication required.',
})
@Controller('scheduled-tasks')
@Roles(UserRole.ADMIN)
export class ScheduledTasksController {
  constructor(private readonly scheduledTasksService: ScheduledTasksService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a scheduled task',
    description:
      'Stores a recurring shell.exec definition and allows the runner to queue due executions.',
  })
  @ApiCreatedResponse({
    description: 'Scheduled task created.',
    type: ScheduledTaskEntity,
  })
  @ApiForbiddenResponse({
    description: 'Insufficient permissions.',
  })
  create(@Body() dto: CreateScheduledTaskDto) {
    return this.scheduledTasksService.create(dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List scheduled tasks',
  })
  @ApiOkResponse({
    description: 'Scheduled task list.',
    type: ScheduledTaskEntity,
    isArray: true,
  })
  findAll() {
    return this.scheduledTasksService.findAll();
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Enable or disable a scheduled task',
  })
  @ApiOkResponse({
    description: 'Scheduled task updated.',
    type: ScheduledTaskEntity,
  })
  update(@Param('id') id: string, @Body() dto: UpdateScheduledTaskDto) {
    return this.scheduledTasksService.updateEnabled(id, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete a scheduled task',
  })
  @ApiOkResponse({
    description: 'Scheduled task deleted.',
    schema: {
      example: {
        deleted: true,
        id: 'b6c8b6be-e54d-46d7-816c-9732cf5efe7d',
      },
    },
  })
  remove(@Param('id') id: string) {
    return this.scheduledTasksService.delete(id);
  }
}
