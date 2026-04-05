import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Request, Response } from 'express';
import { SWAGGER_BEARER_AUTH_NAME } from '../../common/constants/swagger.constants';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WorkspaceRoles } from '../../common/decorators/workspace-roles.decorator';
import { WorkspaceMembershipGuard } from '../../common/guards/workspace-membership.guard';
import { WorkspaceRolesGuard } from '../../common/guards/workspace-roles.guard';
import { AuthenticatedUser } from '../../common/types/authenticated-user.type';
import { WorkspaceMembershipRole } from '../workspaces/entities/workspace-membership-role.enum';
import { CreateLogMonitorRuleDto } from './dto/create-log-monitor-rule.dto';
import { CreateLogPreviewDto } from './dto/create-log-preview.dto';
import { LogPreviewResponseDto } from './dto/log-preview-response.dto';
import { UpdateLogMonitorRuleDto } from './dto/update-log-monitor-rule.dto';
import { LogMonitorRuleEntity } from './entities/log-monitor-rule.entity';
import { IncidentsService } from './incidents.service';

@ApiTags('Workspace Node Log Monitors')
@ApiBearerAuth(SWAGGER_BEARER_AUTH_NAME)
@ApiUnauthorizedResponse({
  description: 'JWT authentication required.',
})
@Controller('workspaces/:workspaceId/nodes/:nodeId')
@UseGuards(WorkspaceMembershipGuard, WorkspaceRolesGuard)
@WorkspaceRoles(WorkspaceMembershipRole.OWNER, WorkspaceMembershipRole.ADMIN)
export class WorkspaceNodeLogMonitorsController {
  constructor(private readonly incidentsService: IncidentsService) {}

  @Get('log-presets')
  @ApiOperation({
    summary: 'List available log source presets for a node',
  })
  @ApiOkResponse({
    description: 'Available Linux log source presets.',
  })
  listPresets() {
    return this.incidentsService.listPresets();
  }

  @Post('log-preview')
  @ApiOperation({
    summary: 'Preview recent lines from a log source preset',
  })
  @ApiOkResponse({
    type: LogPreviewResponseDto,
  })
  @ApiAcceptedResponse({
    type: LogPreviewResponseDto,
  })
  async preview(
    @Param('workspaceId') workspaceId: string,
    @Param('nodeId') nodeId: string,
    @Body() dto: CreateLogPreviewDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.incidentsService.preview(
      workspaceId,
      nodeId,
      dto,
    );
    response.status(result.statusCode);
    return result.body;
  }

  @Get('log-monitor-rules')
  @ApiOperation({
    summary: 'List log monitor rules for a node',
  })
  @ApiOkResponse({
    type: LogMonitorRuleEntity,
    isArray: true,
  })
  listRules(
    @Param('workspaceId') workspaceId: string,
    @Param('nodeId') nodeId: string,
  ) {
    return this.incidentsService.listRules(workspaceId, nodeId);
  }

  @Post('log-monitor-rules')
  @ApiOperation({
    summary: 'Create a log monitor rule for a node',
  })
  @ApiCreatedResponse({
    type: LogMonitorRuleEntity,
  })
  createRule(
    @Param('workspaceId') workspaceId: string,
    @Param('nodeId') nodeId: string,
    @Body() dto: CreateLogMonitorRuleDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.incidentsService.createRule(workspaceId, nodeId, dto, {
      actorType: 'user',
      actorUserId: actor.id,
      actorEmailSnapshot: actor.email,
      ipAddress: request.ip ?? null,
      userAgent: request.headers['user-agent'] ?? null,
    });
  }

  @Patch('log-monitor-rules/:ruleId')
  @ApiOperation({
    summary: 'Update a log monitor rule',
  })
  @ApiOkResponse({
    type: LogMonitorRuleEntity,
  })
  updateRule(
    @Param('workspaceId') workspaceId: string,
    @Param('nodeId') nodeId: string,
    @Param('ruleId') ruleId: string,
    @Body() dto: UpdateLogMonitorRuleDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.incidentsService.updateRule(workspaceId, nodeId, ruleId, dto, {
      actorType: 'user',
      actorUserId: actor.id,
      actorEmailSnapshot: actor.email,
      ipAddress: request.ip ?? null,
      userAgent: request.headers['user-agent'] ?? null,
    });
  }

  @Delete('log-monitor-rules/:ruleId')
  @ApiOperation({
    summary: 'Delete a log monitor rule',
  })
  deleteRule(
    @Param('workspaceId') workspaceId: string,
    @Param('nodeId') nodeId: string,
    @Param('ruleId') ruleId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.incidentsService.deleteRule(workspaceId, nodeId, ruleId, {
      actorType: 'user',
      actorUserId: actor.id,
      actorEmailSnapshot: actor.email,
      ipAddress: request.ip ?? null,
      userAgent: request.headers['user-agent'] ?? null,
    });
  }
}
