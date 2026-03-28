import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Request } from 'express';
import { SWAGGER_BEARER_AUTH_NAME } from '../../common/constants/swagger.constants';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WorkspaceRoles } from '../../common/decorators/workspace-roles.decorator';
import { WorkspaceMembershipGuard } from '../../common/guards/workspace-membership.guard';
import { WorkspaceRolesGuard } from '../../common/guards/workspace-roles.guard';
import { AuthenticatedUser } from '../../common/types/authenticated-user.type';
import { WorkspaceMembershipRole } from '../workspaces/entities/workspace-membership-role.enum';
import { CreateTaskTemplateDto } from './dto/create-task-template.dto';
import { UpdateTaskTemplateDto } from './dto/update-task-template.dto';
import { TaskTemplateEntity } from './entities/task-template.entity';
import { TaskTemplatesService } from './task-templates.service';

const buildAuditContext = (
  request: Request,
  actor: AuthenticatedUser,
) => ({
  actorType: 'user' as const,
  actorUserId: actor.id,
  actorEmailSnapshot: actor.email,
  ipAddress: request.ip ?? null,
  userAgent: request.headers['user-agent'] ?? null,
});

@ApiTags('Workspace Task Templates')
@ApiBearerAuth(SWAGGER_BEARER_AUTH_NAME)
@ApiUnauthorizedResponse({
  description: 'JWT authentication required.',
})
@Controller('workspaces/:workspaceId/task-templates')
@UseGuards(WorkspaceMembershipGuard)
export class WorkspaceTaskTemplatesController {
  constructor(private readonly taskTemplatesService: TaskTemplatesService) {}

  @Get()
  @ApiOkResponse({
    type: TaskTemplateEntity,
    isArray: true,
  })
  findAll(@Param('workspaceId') workspaceId: string) {
    return this.taskTemplatesService.findAll(workspaceId);
  }

  @Post()
  @UseGuards(WorkspaceRolesGuard)
  @WorkspaceRoles(WorkspaceMembershipRole.OWNER, WorkspaceMembershipRole.ADMIN)
  @ApiCreatedResponse({
    type: TaskTemplateEntity,
  })
  create(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateTaskTemplateDto,
    @Req() request: Request,
  ) {
    return this.taskTemplatesService.create(
      workspaceId,
      actor,
      dto,
      buildAuditContext(request, actor),
    );
  }

  @Patch(':id')
  @UseGuards(WorkspaceRolesGuard)
  @WorkspaceRoles(WorkspaceMembershipRole.OWNER, WorkspaceMembershipRole.ADMIN)
  @ApiOkResponse({
    type: TaskTemplateEntity,
  })
  update(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: UpdateTaskTemplateDto,
    @Req() request: Request,
  ) {
    return this.taskTemplatesService.update(
      workspaceId,
      id,
      actor,
      dto,
      buildAuditContext(request, actor),
    );
  }

  @Delete(':id')
  @UseGuards(WorkspaceRolesGuard)
  @WorkspaceRoles(WorkspaceMembershipRole.OWNER, WorkspaceMembershipRole.ADMIN)
  remove(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.taskTemplatesService.delete(workspaceId, id, {
      actorType: 'user',
      actorUserId: actor.id,
      actorEmailSnapshot: actor.email,
      ipAddress: request.ip ?? null,
      userAgent: request.headers['user-agent'] ?? null,
    });
  }
}
