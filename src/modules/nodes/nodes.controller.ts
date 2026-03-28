import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { SWAGGER_BEARER_AUTH_NAME } from '../../common/constants/swagger.constants';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthenticatedUser } from '../../common/types/authenticated-user.type';
import { Request } from 'express';
import { UserRole } from '../users/entities/user-role.enum';
import { CreateNodeDto } from './dto/create-node.dto';
import { EnableNodeMaintenanceDto } from './dto/enable-node-maintenance.dto';
import { QueryNodesDto } from './dto/query-nodes.dto';
import { UpdateNodeTeamDto } from './dto/update-node-team.dto';
import { NodeEntity } from './entities/node.entity';
import { NodesService } from './nodes.service';

@ApiTags('Nodes')
@ApiBearerAuth(SWAGGER_BEARER_AUTH_NAME)
@ApiUnauthorizedResponse({
  description: 'JWT authentication required.',
})
@Controller('nodes')
export class NodesController {
  constructor(private readonly nodesService: NodesService) {}

  @Get()
  @ApiOperation({
    summary: 'List nodes',
    description:
      'Returns all registered nodes, optionally filtered by status or search term. Node status is maintained by heartbeats plus the background offline detector.',
  })
  @ApiOkResponse({
    description: 'List of nodes.',
    type: NodeEntity,
    isArray: true,
  })
  findAll(@Query() query: QueryNodesDto) {
    return this.nodesService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a node by ID',
    description:
      'Returns a single node with its current online or offline status and last heartbeat timestamp.',
  })
  @ApiOkResponse({
    description: 'Node details.',
    type: NodeEntity,
  })
  @ApiNotFoundResponse({
    description: 'Node not found.',
  })
  findOne(@Param('id') id: string) {
    return this.nodesService.findOneOrFail(id);
  }

  @Roles(UserRole.PLATFORM_ADMIN)
  @Post()
  @ApiOperation({
    summary: 'Create a node manually',
    description:
      'Administrative endpoint for creating node records without agent registration.',
  })
  @ApiCreatedResponse({
    description: 'Node created.',
    type: NodeEntity,
  })
  @ApiForbiddenResponse({
    description: 'Platform admin role required.',
  })
  create(@Body() createNodeDto: CreateNodeDto) {
    return this.nodesService.create(createNodeDto);
  }

  @Roles(UserRole.PLATFORM_ADMIN)
  @Post(':id/team')
  assignTeam(
    @Param('id') id: string,
    @Body() dto: UpdateNodeTeamDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.nodesService.updateTeamAssignment(
      id,
      undefined,
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

  @Roles(UserRole.PLATFORM_ADMIN)
  @Post(':id/maintenance/enable')
  enableMaintenance(
    @Param('id') id: string,
    @Body() dto: EnableNodeMaintenanceDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.nodesService.enableMaintenance(
      id,
      undefined,
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

  @Roles(UserRole.PLATFORM_ADMIN)
  @Post(':id/maintenance/disable')
  disableMaintenance(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.nodesService.disableMaintenance(id, undefined, actor, {
      actorType: 'user',
      actorUserId: actor.id,
      actorEmailSnapshot: actor.email,
      ipAddress: request.ip ?? null,
      userAgent: request.headers['user-agent'] ?? null,
    });
  }

  @Roles(UserRole.PLATFORM_ADMIN)
  @Delete(':id')
  @ApiOperation({
    summary: 'Delete a node',
  })
  @ApiOkResponse({
    description: 'Node deleted.',
    schema: {
      example: {
        deleted: true,
        id: 'b7f88611-b63e-4c95-9f37-4afb5c0cf275',
      },
    },
  })
  @ApiForbiddenResponse({
    description: 'Platform admin role required.',
  })
  @ApiNotFoundResponse({
    description: 'Node not found.',
  })
  delete(@Param('id') id: string) {
    return this.nodesService.delete(id);
  }
}
