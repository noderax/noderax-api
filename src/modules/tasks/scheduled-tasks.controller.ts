import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
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
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/authenticated-user.type';
import { Request } from 'express';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../users/entities/user-role.enum';
import { CreateBatchScheduledTaskDto } from './dto/create-batch-scheduled-task.dto';
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
@Roles(UserRole.PLATFORM_ADMIN)
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
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateScheduledTaskDto,
    @Req() request: Request,
  ) {
    return this.scheduledTasksService.create(user.id, undefined, dto, {
      actorType: 'user',
      actorUserId: user.id,
      actorEmailSnapshot: user.email,
      ipAddress: request.ip ?? null,
      userAgent: request.headers['user-agent'] ?? null,
    });
  }

  @Post('batch')
  @ApiOperation({
    summary: 'Create scheduled tasks for multiple nodes',
    description:
      'Stores the same recurring shell.exec definition for multiple target nodes. Requires ADMIN role.',
  })
  @ApiCreatedResponse({
    description: 'Scheduled tasks created.',
    type: ScheduledTaskEntity,
    isArray: true,
  })
  @ApiForbiddenResponse({
    description: 'Insufficient permissions.',
  })
  createBatch(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateBatchScheduledTaskDto,
    @Req() request: Request,
  ) {
    return this.scheduledTasksService.createBatch(user.id, undefined, dto, {
      actorType: 'user',
      actorUserId: user.id,
      actorEmailSnapshot: user.email,
      ipAddress: request.ip ?? null,
      userAgent: request.headers['user-agent'] ?? null,
    });
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
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateScheduledTaskDto,
    @Req() request: Request,
  ) {
    return this.scheduledTasksService.updateEnabled(id, dto, undefined, {
      actorType: 'user',
      actorUserId: user.id,
      actorEmailSnapshot: user.email,
      ipAddress: request.ip ?? null,
      userAgent: request.headers['user-agent'] ?? null,
    });
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
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Req() request: Request,
  ) {
    return this.scheduledTasksService.delete(id, undefined, {
      actorType: 'user',
      actorUserId: user.id,
      actorEmailSnapshot: user.email,
      ipAddress: request.ip ?? null,
      userAgent: request.headers['user-agent'] ?? null,
    });
  }
}
