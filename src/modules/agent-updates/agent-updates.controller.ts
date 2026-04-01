import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { SWAGGER_BEARER_AUTH_NAME } from '../../common/constants/swagger.constants';
import { AuthenticatedUser } from '../../common/types/authenticated-user.type';
import { UserRole } from '../users/entities/user-role.enum';
import { AgentReleaseDto } from './dto/agent-release.dto';
import {
  AgentUpdateRolloutDto,
  AgentUpdateSummaryDto,
} from './dto/agent-update-rollout.dto';
import { CreateAgentUpdateRolloutDto } from './dto/create-agent-update-rollout.dto';
import { AgentUpdatesService } from './agent-updates.service';

@ApiTags('Agent Updates')
@ApiBearerAuth(SWAGGER_BEARER_AUTH_NAME)
@ApiUnauthorizedResponse({
  description: 'JWT authentication required.',
})
@Roles(UserRole.PLATFORM_ADMIN)
@Controller('agent-updates')
export class AgentUpdatesController {
  constructor(private readonly agentUpdatesService: AgentUpdatesService) {}

  @Get('summary')
  @ApiOperation({
    summary: 'Get current official agent update summary',
  })
  @ApiOkResponse({
    type: AgentUpdateSummaryDto,
  })
  getSummary() {
    return this.agentUpdatesService.getSummary();
  }

  @Get('releases')
  @ApiOperation({
    summary: 'List official tagged agent releases',
  })
  @ApiOkResponse({
    type: AgentReleaseDto,
    isArray: true,
  })
  listReleases() {
    return this.agentUpdatesService.listReleases();
  }

  @Get('rollouts')
  @ApiOperation({
    summary: 'List recent agent update rollouts',
  })
  @ApiOkResponse({
    type: AgentUpdateRolloutDto,
    isArray: true,
  })
  listRollouts() {
    return this.agentUpdatesService.listRollouts();
  }

  @Get('rollouts/:id')
  @ApiOperation({
    summary: 'Get an agent update rollout',
  })
  @ApiOkResponse({
    type: AgentUpdateRolloutDto,
  })
  getRollout(@Param('id') id: string) {
    return this.agentUpdatesService.getRollout(id);
  }

  @Post('rollouts')
  @ApiOperation({
    summary: 'Create an agent update rollout',
  })
  @ApiBody({ type: CreateAgentUpdateRolloutDto })
  @ApiCreatedResponse({
    type: AgentUpdateRolloutDto,
  })
  createRollout(
    @Body() dto: CreateAgentUpdateRolloutDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.agentUpdatesService.createRollout(dto, {
      actorType: 'user',
      actorUserId: actor.id,
      actorEmailSnapshot: actor.email,
      ipAddress: request.ip ?? null,
      userAgent: request.headers['user-agent'] ?? null,
    });
  }

  @Post('rollouts/:id/resume')
  @ApiOperation({
    summary: 'Resume a paused agent update rollout',
  })
  @ApiOkResponse({
    type: AgentUpdateRolloutDto,
  })
  resumeRollout(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.agentUpdatesService.resumeRollout(id, {
      actorType: 'user',
      actorUserId: actor.id,
      actorEmailSnapshot: actor.email,
      ipAddress: request.ip ?? null,
      userAgent: request.headers['user-agent'] ?? null,
    });
  }

  @Post('rollouts/:id/cancel')
  @ApiOperation({
    summary: 'Cancel an active agent update rollout',
  })
  @ApiOkResponse({
    type: AgentUpdateRolloutDto,
  })
  cancelRollout(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.agentUpdatesService.cancelRollout(id, {
      actorType: 'user',
      actorUserId: actor.id,
      actorEmailSnapshot: actor.email,
      ipAddress: request.ip ?? null,
      userAgent: request.headers['user-agent'] ?? null,
    });
  }

  @Post('rollouts/:id/targets/:targetId/retry')
  @ApiOperation({
    summary: 'Retry a failed rollout target',
  })
  @ApiOkResponse({
    type: AgentUpdateRolloutDto,
  })
  retryTarget(
    @Param('id') rolloutId: string,
    @Param('targetId') targetId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.agentUpdatesService.retryTarget(rolloutId, targetId, {
      actorType: 'user',
      actorUserId: actor.id,
      actorEmailSnapshot: actor.email,
      ipAddress: request.ip ?? null,
      userAgent: request.headers['user-agent'] ?? null,
    });
  }

  @Post('rollouts/:id/targets/:targetId/skip')
  @ApiOperation({
    summary: 'Skip a failed rollout target and continue',
  })
  @ApiOkResponse({
    type: AgentUpdateRolloutDto,
  })
  skipTarget(
    @Param('id') rolloutId: string,
    @Param('targetId') targetId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.agentUpdatesService.skipTarget(rolloutId, targetId, {
      actorType: 'user',
      actorUserId: actor.id,
      actorEmailSnapshot: actor.email,
      ipAddress: request.ip ?? null,
      userAgent: request.headers['user-agent'] ?? null,
    });
  }
}
