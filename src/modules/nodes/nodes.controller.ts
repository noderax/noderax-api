import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../users/entities/user-role.enum';
import { CreateNodeDto } from './dto/create-node.dto';
import { QueryNodesDto } from './dto/query-nodes.dto';
import { NodesService } from './nodes.service';

@Controller('nodes')
export class NodesController {
  constructor(private readonly nodesService: NodesService) {}

  @Get()
  findAll(@Query() query: QueryNodesDto) {
    return this.nodesService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.nodesService.findOneOrFail(id);
  }

  @Roles(UserRole.ADMIN)
  @Post()
  create(@Body() createNodeDto: CreateNodeDto) {
    return this.nodesService.create(createNodeDto);
  }

  @Roles(UserRole.ADMIN)
  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.nodesService.delete(id);
  }
}
