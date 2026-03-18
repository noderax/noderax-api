import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
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
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../users/entities/user-role.enum';
import { CreateNodeDto } from './dto/create-node.dto';
import { QueryNodesDto } from './dto/query-nodes.dto';
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

  @Roles(UserRole.ADMIN)
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
    description: 'Admin role required.',
  })
  create(@Body() createNodeDto: CreateNodeDto) {
    return this.nodesService.create(createNodeDto);
  }

  @Roles(UserRole.ADMIN)
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
    description: 'Admin role required.',
  })
  @ApiNotFoundResponse({
    description: 'Node not found.',
  })
  delete(@Param('id') id: string) {
    return this.nodesService.delete(id);
  }
}
