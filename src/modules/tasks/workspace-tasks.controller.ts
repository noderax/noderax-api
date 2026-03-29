import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { SWAGGER_BEARER_AUTH_NAME } from '../../common/constants/swagger.constants';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WorkspaceRoles } from '../../common/decorators/workspace-roles.decorator';
import { WorkspaceMembershipGuard } from '../../common/guards/workspace-membership.guard';
import { WorkspaceRolesGuard } from '../../common/guards/workspace-roles.guard';
import { AuthenticatedUser } from '../../common/types/authenticated-user.type';
import { Request } from 'express';
import { WorkspaceMembershipRole } from '../workspaces/entities/workspace-membership-role.enum';
import { CreateBatchTaskDto } from './dto/create-batch-task.dto';
import { CreateTeamTaskDto } from './dto/create-team-task.dto';
import { CreateTaskDto } from './dto/create-task.dto';
import { QueryTaskLogsDto } from './dto/query-task-logs.dto';
import { QueryTasksDto } from './dto/query-tasks.dto';
import { RequestTaskCancelDto } from './dto/request-task-cancel.dto';
import { TaskLogEntity } from './entities/task-log.entity';
import { TaskEntity } from './entities/task.entity';
import { TasksService } from './tasks.service';

@ApiTags('Workspace Tasks')
@ApiBearerAuth(SWAGGER_BEARER_AUTH_NAME)
@ApiUnauthorizedResponse({
  description: 'JWT authentication required.',
})
@Controller('workspaces/:workspaceId/tasks')
@UseGuards(WorkspaceMembershipGuard)
export class WorkspaceTasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post()
  @UseGuards(WorkspaceRolesGuard)
  @WorkspaceRoles(WorkspaceMembershipRole.OWNER, WorkspaceMembershipRole.ADMIN)
  @ApiOperation({
    summary: 'Create a task in a workspace',
  })
  @ApiCreatedResponse({
    type: TaskEntity,
  })
  create(
    @Param('workspaceId') workspaceId: string,
    @Body() createTaskDto: CreateTaskDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.tasksService.create(createTaskDto, workspaceId, {
      actorType: 'user',
      actorUserId: actor.id,
      actorEmailSnapshot: actor.email,
      ipAddress: request.ip ?? null,
      userAgent: request.headers['user-agent'] ?? null,
    });
  }

  @Post('batch')
  @UseGuards(WorkspaceRolesGuard)
  @WorkspaceRoles(WorkspaceMembershipRole.OWNER, WorkspaceMembershipRole.ADMIN)
  @ApiOperation({
    summary: 'Create tasks for multiple workspace nodes',
  })
  @ApiCreatedResponse({
    type: TaskEntity,
    isArray: true,
  })
  createBatch(
    @Param('workspaceId') workspaceId: string,
    @Body() createBatchTaskDto: CreateBatchTaskDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.tasksService.createBatch(createBatchTaskDto, workspaceId, {
      actorType: 'user',
      actorUserId: actor.id,
      actorEmailSnapshot: actor.email,
      ipAddress: request.ip ?? null,
      userAgent: request.headers['user-agent'] ?? null,
    });
  }

  @Post('teams/:teamId')
  @UseGuards(WorkspaceRolesGuard)
  @WorkspaceRoles(WorkspaceMembershipRole.OWNER, WorkspaceMembershipRole.ADMIN)
  createForTeam(
    @Param('workspaceId') workspaceId: string,
    @Param('teamId') teamId: string,
    @Body() dto: CreateTeamTaskDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.tasksService.createForTeam(
      {
        workspaceId,
        teamId,
        type: dto.type,
        payload: dto.payload ?? {},
        templateId: dto.templateId,
      },
      {
        actorType: 'user',
        actorUserId: actor.id,
        actorEmailSnapshot: actor.email,
        ipAddress: request.ip ?? null,
        userAgent: request.headers['user-agent'] ?? null,
      },
    );
  }

  @Get()
  @ApiOperation({
    summary: 'List tasks in a workspace',
  })
  @ApiOkResponse({
    type: TaskEntity,
    isArray: true,
  })
  findAll(
    @Param('workspaceId') workspaceId: string,
    @Query() query: QueryTasksDto,
  ) {
    return this.tasksService.findAll(query, workspaceId);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a task by ID in a workspace',
  })
  @ApiOkResponse({
    type: TaskEntity,
  })
  findOne(@Param('workspaceId') workspaceId: string, @Param('id') id: string) {
    return this.tasksService.findOneOrFail(id, workspaceId);
  }

  @Get(':id/logs')
  @ApiOperation({
    summary: 'List task logs in a workspace',
  })
  @ApiOkResponse({
    type: TaskLogEntity,
    isArray: true,
  })
  findLogs(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Query() query: QueryTaskLogsDto,
  ) {
    return this.tasksService.findLogs(id, query, workspaceId);
  }

  @Post(':id/cancel')
  @UseGuards(WorkspaceRolesGuard)
  @WorkspaceRoles(WorkspaceMembershipRole.OWNER, WorkspaceMembershipRole.ADMIN)
  @ApiOperation({
    summary: 'Cancel a task in a workspace',
  })
  cancel(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Body() dto: RequestTaskCancelDto,
  ) {
    return this.tasksService.requestTaskCancellation(id, dto, workspaceId);
  }
}
