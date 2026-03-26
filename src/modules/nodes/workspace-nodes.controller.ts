import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
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
import { WorkspaceRoles } from '../../common/decorators/workspace-roles.decorator';
import { WorkspaceMembershipGuard } from '../../common/guards/workspace-membership.guard';
import { WorkspaceRolesGuard } from '../../common/guards/workspace-roles.guard';
import { WorkspaceMembershipRole } from '../workspaces/entities/workspace-membership-role.enum';
import { CreateNodeDto } from './dto/create-node.dto';
import { QueryNodesDto } from './dto/query-nodes.dto';
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
  constructor(private readonly nodesService: NodesService) {}

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

  @Delete(':id')
  @UseGuards(WorkspaceRolesGuard)
  @WorkspaceRoles(WorkspaceMembershipRole.OWNER, WorkspaceMembershipRole.ADMIN)
  @ApiOperation({
    summary: 'Delete a node in a workspace',
  })
  delete(@Param('workspaceId') workspaceId: string, @Param('id') id: string) {
    return this.nodesService.delete(id, workspaceId);
  }
}
