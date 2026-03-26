import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
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
import { WorkspaceMembershipRole } from '../workspaces/entities/workspace-membership-role.enum';
import { CreateBatchScheduledTaskDto } from './dto/create-batch-scheduled-task.dto';
import { CreateScheduledTaskDto } from './dto/create-scheduled-task.dto';
import { UpdateScheduledTaskDto } from './dto/update-scheduled-task.dto';
import { ScheduledTaskEntity } from './entities/scheduled-task.entity';
import { ScheduledTasksService } from './scheduled-tasks.service';

@ApiTags('Workspace Scheduled Tasks')
@ApiBearerAuth(SWAGGER_BEARER_AUTH_NAME)
@ApiUnauthorizedResponse({
  description: 'JWT authentication required.',
})
@Controller('workspaces/:workspaceId/scheduled-tasks')
@UseGuards(WorkspaceMembershipGuard)
export class WorkspaceScheduledTasksController {
  constructor(private readonly scheduledTasksService: ScheduledTasksService) {}

  @Post()
  @UseGuards(WorkspaceRolesGuard)
  @WorkspaceRoles(WorkspaceMembershipRole.OWNER, WorkspaceMembershipRole.ADMIN)
  @ApiOperation({
    summary: 'Create a scheduled task in a workspace',
  })
  @ApiCreatedResponse({
    type: ScheduledTaskEntity,
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId') workspaceId: string,
    @Body() dto: CreateScheduledTaskDto,
  ) {
    return this.scheduledTasksService.create(user.id, workspaceId, dto);
  }

  @Post('batch')
  @UseGuards(WorkspaceRolesGuard)
  @WorkspaceRoles(WorkspaceMembershipRole.OWNER, WorkspaceMembershipRole.ADMIN)
  @ApiCreatedResponse({
    type: ScheduledTaskEntity,
    isArray: true,
  })
  createBatch(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId') workspaceId: string,
    @Body() dto: CreateBatchScheduledTaskDto,
  ) {
    return this.scheduledTasksService.createBatch(user.id, workspaceId, dto);
  }

  @Get()
  @ApiOkResponse({
    type: ScheduledTaskEntity,
    isArray: true,
  })
  findAll(@Param('workspaceId') workspaceId: string) {
    return this.scheduledTasksService.findAll(workspaceId);
  }

  @Patch(':id')
  @UseGuards(WorkspaceRolesGuard)
  @WorkspaceRoles(WorkspaceMembershipRole.OWNER, WorkspaceMembershipRole.ADMIN)
  @ApiOkResponse({
    type: ScheduledTaskEntity,
  })
  update(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Body() dto: UpdateScheduledTaskDto,
  ) {
    return this.scheduledTasksService.updateEnabled(id, dto, workspaceId);
  }

  @Delete(':id')
  @UseGuards(WorkspaceRolesGuard)
  @WorkspaceRoles(WorkspaceMembershipRole.OWNER, WorkspaceMembershipRole.ADMIN)
  @ApiOperation({
    summary: 'Delete a scheduled task in a workspace',
  })
  remove(@Param('workspaceId') workspaceId: string, @Param('id') id: string) {
    return this.scheduledTasksService.delete(id, workspaceId);
  }
}
