import {
  Body,
  Controller,
  Delete,
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
import { AgentRealtimeService } from '../agent-realtime/agent-realtime.service';
import { CreateNodeDto } from './dto/create-node.dto';
import { EnableNodeMaintenanceDto } from './dto/enable-node-maintenance.dto';
import { QueryNodesDto } from './dto/query-nodes.dto';
import { UpdateNodeNotificationsDto } from './dto/update-node-notifications.dto';
import { UpdateNodeRootAccessDto } from './dto/update-node-root-access.dto';
import { UpdateNodeTeamDto } from './dto/update-node-team.dto';
import { NodeEntity } from './entities/node.entity';
import { NodesService } from './nodes.service';

@ApiTags('Workspace Nodes')
@ApiBearerAuth(SWAGGER_BEARER_AUTH_NAME)
@ApiUnauthorizedResponse({
  description: 'JWT authentication required.',
})
@Controller('workspaces/:workspaceId/nodes')
@UseGuards(WorkspaceMembershipGuard)
export class WorkspaceNodesController {
  constructor(
    private readonly nodesService: NodesService,
    private readonly agentRealtimeService: AgentRealtimeService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List workspace nodes',
  })
  @ApiOkResponse({
    type: NodeEntity,
    isArray: true,
  })
  findAll(
    @Param('workspaceId') workspaceId: string,
    @Query() query: QueryNodesDto,
  ) {
    return this.nodesService.findAll(query, workspaceId);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a workspace node by ID',
  })
  @ApiOkResponse({
    type: NodeEntity,
  })
  findOne(@Param('workspaceId') workspaceId: string, @Param('id') id: string) {
    return this.nodesService.findOneOrFail(id, workspaceId);
  }

  @Post()
  @UseGuards(WorkspaceRolesGuard)
  @WorkspaceRoles(WorkspaceMembershipRole.OWNER, WorkspaceMembershipRole.ADMIN)
  @ApiOperation({
    summary: 'Create a node in a workspace',
  })
  @ApiCreatedResponse({
    type: NodeEntity,
  })
  create(
    @Param('workspaceId') workspaceId: string,
    @Body() createNodeDto: CreateNodeDto,
  ) {
    return this.nodesService.create(createNodeDto, workspaceId);
  }

  @Post(':id/team')
  @UseGuards(WorkspaceRolesGuard)
  @WorkspaceRoles(WorkspaceMembershipRole.OWNER, WorkspaceMembershipRole.ADMIN)
  assignTeam(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Body() dto: UpdateNodeTeamDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.nodesService.updateTeamAssignment(
      id,
      workspaceId,
      actor,
      dto.teamId,
      {
        actorType: 'user',
        actorUserId: actor.id,
        actorEmailSnapshot: actor.email,
        ipAddress: request.ip ?? null,
        userAgent: request.headers['user-agent'] ?? null,
      },
    );
  }

  @Post(':id/maintenance/enable')
  @UseGuards(WorkspaceRolesGuard)
  @WorkspaceRoles(WorkspaceMembershipRole.OWNER, WorkspaceMembershipRole.ADMIN)
  enableMaintenance(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Body() dto: EnableNodeMaintenanceDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.nodesService.enableMaintenance(
      id,
      workspaceId,
      actor,
      dto.reason,
      {
        actorType: 'user',
        actorUserId: actor.id,
        actorEmailSnapshot: actor.email,
        ipAddress: request.ip ?? null,
        userAgent: request.headers['user-agent'] ?? null,
      },
    );
  }

  @Post(':id/maintenance/disable')
  @UseGuards(WorkspaceRolesGuard)
  @WorkspaceRoles(WorkspaceMembershipRole.OWNER, WorkspaceMembershipRole.ADMIN)
  disableMaintenance(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.nodesService.disableMaintenance(id, workspaceId, actor, {
      actorType: 'user',
      actorUserId: actor.id,
      actorEmailSnapshot: actor.email,
      ipAddress: request.ip ?? null,
      userAgent: request.headers['user-agent'] ?? null,
    });
  }

  @Post(':id/root-access')
  @UseGuards(WorkspaceRolesGuard)
  @WorkspaceRoles(WorkspaceMembershipRole.OWNER, WorkspaceMembershipRole.ADMIN)
  async updateRootAccess(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Body() dto: UpdateNodeRootAccessDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: Request,
  ) {
    const node = await this.nodesService.updateRootAccessProfile(
      id,
      workspaceId,
      actor,
      dto,
      {
        actorType: 'user',
        actorUserId: actor.id,
        actorEmailSnapshot: actor.email,
        ipAddress: request.ip ?? null,
        userAgent: request.headers['user-agent'] ?? null,
      },
    );

    await this.agentRealtimeService.dispatchRootAccessUpdate(
      node.id,
      this.nodesService.buildDesiredRootAccessSnapshot(node),
    );

    return node;
  }

  @Post(':id/notifications')
  @UseGuards(WorkspaceRolesGuard)
  @WorkspaceRoles(WorkspaceMembershipRole.OWNER, WorkspaceMembershipRole.ADMIN)
  updateNotifications(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Body() dto: UpdateNodeNotificationsDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.nodesService.updateNotificationSettings(
      id,
      workspaceId,
      actor,
      dto,
      {
        actorType: 'user',
        actorUserId: actor.id,
        actorEmailSnapshot: actor.email,
        ipAddress: request.ip ?? null,
        userAgent: request.headers['user-agent'] ?? null,
      },
    );
  }

  @Delete(':id')
  @UseGuards(WorkspaceRolesGuard)
  @WorkspaceRoles(WorkspaceMembershipRole.OWNER, WorkspaceMembershipRole.ADMIN)
  @ApiOperation({
    summary: 'Delete a node in a workspace',
  })
  delete(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.nodesService.delete(id, workspaceId, actor, {
      actorType: 'user',
      actorUserId: actor.id,
      actorEmailSnapshot: actor.email,
      ipAddress: request.ip ?? null,
      userAgent: request.headers['user-agent'] ?? null,
    });
  }
}
