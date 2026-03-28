import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
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
import { Roles } from '../../common/decorators/roles.decorator';
import { WorkspaceRoles } from '../../common/decorators/workspace-roles.decorator';
import { WorkspaceMembershipGuard } from '../../common/guards/workspace-membership.guard';
import { WorkspaceRolesGuard } from '../../common/guards/workspace-roles.guard';
import { AuthenticatedUser } from '../../common/types/authenticated-user.type';
import { UserRole } from '../users/entities/user-role.enum';
import { AddTeamMemberDto } from './dto/add-team-member.dto';
import { AssignableUserDto } from './dto/assignable-user.dto';
import { CreateTeamDto } from './dto/create-team.dto';
import { CreateWorkspaceMemberDto } from './dto/create-workspace-member.dto';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { QueryWorkspaceSearchDto } from './dto/query-workspace-search.dto';
import { UpdateTeamDto } from './dto/update-team.dto';
import { UpdateWorkspaceMemberDto } from './dto/update-workspace-member.dto';
import { UpdateWorkspaceDto } from './dto/update-workspace.dto';
import { WorkspaceSearchResponseDto } from './dto/workspace-search-response.dto';
import { WorkspaceMembershipRole } from './entities/workspace-membership-role.enum';
import { TeamEntity } from './entities/team.entity';
import { WorkspaceMembershipEntity } from './entities/workspace-membership.entity';
import { WorkspaceEntity } from './entities/workspace.entity';
import { WorkspacesService } from './workspaces.service';

@ApiTags('Workspaces')
@ApiBearerAuth(SWAGGER_BEARER_AUTH_NAME)
@ApiUnauthorizedResponse({
  description: 'JWT authentication required.',
})
@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  @Get()
  @ApiOperation({
    summary: 'List accessible workspaces',
  })
  @ApiOkResponse({
    type: WorkspaceEntity,
    isArray: true,
  })
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.workspacesService.findAccessibleWorkspaces(user);
  }

  @Roles(UserRole.PLATFORM_ADMIN)
  @Post()
  @ApiOperation({
    summary: 'Create a workspace',
  })
  @ApiCreatedResponse({
    type: WorkspaceEntity,
  })
  @ApiForbiddenResponse({
    description: 'Platform admin access required.',
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateWorkspaceDto,
  ) {
    return this.workspacesService.createWorkspace(user, dto);
  }

  @Get(':workspaceId')
  @UseGuards(WorkspaceMembershipGuard)
  @ApiOperation({
    summary: 'Get workspace detail',
  })
  @ApiOkResponse({
    type: WorkspaceEntity,
  })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId') workspaceId: string,
  ) {
    return this.workspacesService.findWorkspaceForUserOrFail(workspaceId, user);
  }

  @Patch(':workspaceId')
  @UseGuards(WorkspaceMembershipGuard, WorkspaceRolesGuard)
  @WorkspaceRoles(WorkspaceMembershipRole.OWNER, WorkspaceMembershipRole.ADMIN)
  @ApiOperation({
    summary: 'Update workspace settings',
  })
  @ApiOkResponse({
    type: WorkspaceEntity,
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId') workspaceId: string,
    @Body() dto: UpdateWorkspaceDto,
  ) {
    return this.workspacesService.updateWorkspace(workspaceId, user, dto);
  }

  @Delete(':workspaceId')
  @UseGuards(WorkspaceMembershipGuard, WorkspaceRolesGuard)
  @WorkspaceRoles(WorkspaceMembershipRole.OWNER, WorkspaceMembershipRole.ADMIN)
  @ApiOperation({
    summary: 'Delete a workspace',
  })
  @ApiOkResponse({
    schema: {
      example: {
        deleted: true,
        id: '9d4174b9-5dc2-4891-8d1b-f0a2f6c4e52c',
        slug: 'acme-ops',
      },
    },
  })
  delete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId') workspaceId: string,
  ) {
    return this.workspacesService.deleteWorkspace(workspaceId, user);
  }

  @Get(':workspaceId/members')
  @UseGuards(WorkspaceMembershipGuard)
  @ApiOperation({
    summary: 'List workspace members',
  })
  @ApiOkResponse({
    type: WorkspaceMembershipEntity,
    isArray: true,
  })
  listMembers(@Param('workspaceId') workspaceId: string) {
    return this.workspacesService.listMembers(workspaceId);
  }

  @Get(':workspaceId/assignable-users')
  @UseGuards(WorkspaceMembershipGuard, WorkspaceRolesGuard)
  @WorkspaceRoles(WorkspaceMembershipRole.OWNER, WorkspaceMembershipRole.ADMIN)
  @ApiOperation({
    summary: 'List active users that can be added to the workspace',
  })
  @ApiOkResponse({
    type: AssignableUserDto,
    isArray: true,
  })
  listAssignableUsers(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId') workspaceId: string,
  ) {
    return this.workspacesService.listAssignableUsers(workspaceId, user);
  }

  @Get(':workspaceId/search')
  @UseGuards(WorkspaceMembershipGuard)
  @ApiOperation({
    summary: 'Search across workspace resources',
  })
  @ApiOkResponse({
    type: WorkspaceSearchResponseDto,
  })
  searchWorkspace(
    @Param('workspaceId') workspaceId: string,
    @Query() query: QueryWorkspaceSearchDto,
  ) {
    return this.workspacesService.searchWorkspace(
      workspaceId,
      query.q,
      query.limit,
    );
  }

  @Post(':workspaceId/members')
  @UseGuards(WorkspaceMembershipGuard, WorkspaceRolesGuard)
  @WorkspaceRoles(WorkspaceMembershipRole.OWNER, WorkspaceMembershipRole.ADMIN)
  @ApiOperation({
    summary: 'Add a workspace member',
  })
  @ApiCreatedResponse({
    type: WorkspaceMembershipEntity,
  })
  addMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId') workspaceId: string,
    @Body() dto: CreateWorkspaceMemberDto,
  ) {
    return this.workspacesService.addMember(workspaceId, user, dto);
  }

  @Patch(':workspaceId/members/:membershipId')
  @UseGuards(WorkspaceMembershipGuard, WorkspaceRolesGuard)
  @WorkspaceRoles(WorkspaceMembershipRole.OWNER, WorkspaceMembershipRole.ADMIN)
  @ApiOperation({
    summary: 'Update workspace member role',
  })
  @ApiOkResponse({
    type: WorkspaceMembershipEntity,
  })
  updateMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId') workspaceId: string,
    @Param('membershipId') membershipId: string,
    @Body() dto: UpdateWorkspaceMemberDto,
  ) {
    return this.workspacesService.updateMember(
      workspaceId,
      membershipId,
      user,
      dto,
    );
  }

  @Delete(':workspaceId/members/:membershipId')
  @UseGuards(WorkspaceMembershipGuard, WorkspaceRolesGuard)
  @WorkspaceRoles(WorkspaceMembershipRole.OWNER, WorkspaceMembershipRole.ADMIN)
  @ApiOperation({
    summary: 'Remove a workspace member',
  })
  removeMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId') workspaceId: string,
    @Param('membershipId') membershipId: string,
  ) {
    return this.workspacesService.removeMember(workspaceId, membershipId, user);
  }

  @Get(':workspaceId/teams')
  @UseGuards(WorkspaceMembershipGuard)
  @ApiOperation({
    summary: 'List workspace teams',
  })
  @ApiOkResponse({
    type: TeamEntity,
    isArray: true,
  })
  listTeams(@Param('workspaceId') workspaceId: string) {
    return this.workspacesService.listTeams(workspaceId);
  }

  @Post(':workspaceId/teams')
  @UseGuards(WorkspaceMembershipGuard, WorkspaceRolesGuard)
  @WorkspaceRoles(WorkspaceMembershipRole.OWNER, WorkspaceMembershipRole.ADMIN)
  @ApiCreatedResponse({
    type: TeamEntity,
  })
  createTeam(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId') workspaceId: string,
    @Body() dto: CreateTeamDto,
  ) {
    return this.workspacesService.createTeam(workspaceId, user, dto);
  }

  @Patch(':workspaceId/teams/:teamId')
  @UseGuards(WorkspaceMembershipGuard, WorkspaceRolesGuard)
  @WorkspaceRoles(WorkspaceMembershipRole.OWNER, WorkspaceMembershipRole.ADMIN)
  @ApiOkResponse({
    type: TeamEntity,
  })
  updateTeam(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId') workspaceId: string,
    @Param('teamId') teamId: string,
    @Body() dto: UpdateTeamDto,
  ) {
    return this.workspacesService.updateTeam(workspaceId, teamId, user, dto);
  }

  @Delete(':workspaceId/teams/:teamId')
  @UseGuards(WorkspaceMembershipGuard, WorkspaceRolesGuard)
  @WorkspaceRoles(WorkspaceMembershipRole.OWNER, WorkspaceMembershipRole.ADMIN)
  removeTeam(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId') workspaceId: string,
    @Param('teamId') teamId: string,
  ) {
    return this.workspacesService.deleteTeam(workspaceId, teamId, user);
  }

  @Get(':workspaceId/teams/:teamId/members')
  @UseGuards(WorkspaceMembershipGuard)
  listTeamMembers(
    @Param('workspaceId') workspaceId: string,
    @Param('teamId') teamId: string,
  ) {
    return this.workspacesService.listTeamMembers(workspaceId, teamId);
  }

  @Post(':workspaceId/teams/:teamId/members')
  @UseGuards(WorkspaceMembershipGuard, WorkspaceRolesGuard)
  @WorkspaceRoles(WorkspaceMembershipRole.OWNER, WorkspaceMembershipRole.ADMIN)
  addTeamMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId') workspaceId: string,
    @Param('teamId') teamId: string,
    @Body() dto: AddTeamMemberDto,
  ) {
    return this.workspacesService.addTeamMember(workspaceId, teamId, user, dto);
  }

  @Delete(':workspaceId/teams/:teamId/members/:userId')
  @UseGuards(WorkspaceMembershipGuard, WorkspaceRolesGuard)
  @WorkspaceRoles(WorkspaceMembershipRole.OWNER, WorkspaceMembershipRole.ADMIN)
  removeTeamMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId') workspaceId: string,
    @Param('teamId') teamId: string,
    @Param('userId') userId: string,
  ) {
    return this.workspacesService.removeTeamMember(
      workspaceId,
      teamId,
      userId,
      user,
    );
  }
}
