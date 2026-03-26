import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { SWAGGER_BEARER_AUTH_NAME } from '../../common/constants/swagger.constants';
import { WorkspaceMembershipGuard } from '../../common/guards/workspace-membership.guard';
import { QueryEventsDto } from './dto/query-events.dto';
import { EventEntity } from './entities/event.entity';
import { EventsService } from './events.service';

@ApiTags('Workspace Events')
@ApiBearerAuth(SWAGGER_BEARER_AUTH_NAME)
@ApiUnauthorizedResponse({
  description: 'JWT authentication required.',
})
@Controller('workspaces/:workspaceId/events')
@UseGuards(WorkspaceMembershipGuard)
export class WorkspaceEventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get()
  @ApiOperation({
    summary: 'List events in a workspace',
  })
  @ApiOkResponse({
    type: EventEntity,
    isArray: true,
  })
  findAll(
    @Param('workspaceId') workspaceId: string,
    @Query() query: QueryEventsDto,
  ) {
    return this.eventsService.findAll(query, workspaceId);
  }
}
