import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
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
import {
  IncidentAnalysisRequestDto,
  IncidentAnalysisResponseDto,
} from './dto/log-preview-response.dto';
import { QueryIncidentsDto } from './dto/query-incidents.dto';
import { IncidentEntity } from './entities/incident.entity';
import { IncidentsService } from './incidents.service';

@ApiTags('Workspace Incidents')
@ApiBearerAuth(SWAGGER_BEARER_AUTH_NAME)
@ApiUnauthorizedResponse({
  description: 'JWT authentication required.',
})
@Controller('workspaces/:workspaceId/incidents')
@UseGuards(WorkspaceMembershipGuard, WorkspaceRolesGuard)
@WorkspaceRoles(WorkspaceMembershipRole.OWNER, WorkspaceMembershipRole.ADMIN)
export class WorkspaceIncidentsController {
  constructor(private readonly incidentsService: IncidentsService) {}

  @Get()
  @ApiOperation({
    summary: 'List workspace incidents',
  })
  @ApiOkResponse({
    type: IncidentEntity,
    isArray: true,
  })
  list(
    @Param('workspaceId') workspaceId: string,
    @Query() query: QueryIncidentsDto,
  ) {
    return this.incidentsService.listIncidents(workspaceId, query);
  }

  @Post(':incidentId/ack')
  @ApiOperation({
    summary: 'Acknowledge an incident',
  })
  @ApiOkResponse({
    type: IncidentEntity,
  })
  acknowledge(
    @Param('workspaceId') workspaceId: string,
    @Param('incidentId') incidentId: string,
  ) {
    return this.incidentsService.acknowledgeIncident(workspaceId, incidentId);
  }

  @Post(':incidentId/resolve')
  @ApiOperation({
    summary: 'Resolve an incident',
  })
  @ApiOkResponse({
    type: IncidentEntity,
  })
  resolve(
    @Param('workspaceId') workspaceId: string,
    @Param('incidentId') incidentId: string,
  ) {
    return this.incidentsService.resolveIncident(workspaceId, incidentId);
  }

  @Post(':incidentId/analyze')
  @ApiOperation({
    summary: 'Run manual AI analysis for an incident',
  })
  @ApiOkResponse({
    type: IncidentAnalysisResponseDto,
  })
  analyze(
    @Param('workspaceId') workspaceId: string,
    @Param('incidentId') incidentId: string,
    @Body() dto: IncidentAnalysisRequestDto,
  ) {
    return this.incidentsService.analyzeIncident(workspaceId, incidentId, dto);
  }
}
