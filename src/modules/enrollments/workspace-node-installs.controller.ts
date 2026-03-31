import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { SWAGGER_BEARER_AUTH_NAME } from '../../common/constants/swagger.constants';
import { WorkspaceRoles } from '../../common/decorators/workspace-roles.decorator';
import { WorkspaceMembershipGuard } from '../../common/guards/workspace-membership.guard';
import { WorkspaceRolesGuard } from '../../common/guards/workspace-roles.guard';
import { WorkspaceMembershipRole } from '../workspaces/entities/workspace-membership-role.enum';
import { CreateNodeInstallDto } from './dto/create-node-install.dto';
import { CreateNodeInstallResponseDto } from './dto/create-node-install-response.dto';
import { EnrollmentsService } from './enrollments.service';

@ApiTags('Workspace Node Installs')
@ApiBearerAuth(SWAGGER_BEARER_AUTH_NAME)
@ApiExtraModels(CreateNodeInstallDto, CreateNodeInstallResponseDto)
@ApiUnauthorizedResponse({
  description: 'JWT authentication required.',
})
@Controller('workspaces/:workspaceId/node-installs')
@UseGuards(WorkspaceMembershipGuard)
export class WorkspaceNodeInstallsController {
  constructor(private readonly enrollmentsService: EnrollmentsService) {}

  @Post()
  @UseGuards(WorkspaceRolesGuard)
  @WorkspaceRoles(WorkspaceMembershipRole.OWNER, WorkspaceMembershipRole.ADMIN)
  @ApiOperation({
    summary: 'Generate a one-click node install command for a workspace',
  })
  @ApiBody({
    type: CreateNodeInstallDto,
  })
  @ApiCreatedResponse({
    type: CreateNodeInstallResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'Workspace owner or admin access required.',
  })
  create(
    @Param('workspaceId') workspaceId: string,
    @Body() body: CreateNodeInstallDto,
  ) {
    return this.enrollmentsService.createNodeInstall(workspaceId, body);
  }
}
