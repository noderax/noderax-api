import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
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
import { Request } from 'express';
import { SWAGGER_BEARER_AUTH_NAME } from '../../common/constants/swagger.constants';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WorkspaceRoles } from '../../common/decorators/workspace-roles.decorator';
import { WorkspaceMembershipGuard } from '../../common/guards/workspace-membership.guard';
import { WorkspaceRolesGuard } from '../../common/guards/workspace-roles.guard';
import { AuthenticatedUser } from '../../common/types/authenticated-user.type';
import { WorkspaceMembershipRole } from '../workspaces/entities/workspace-membership-role.enum';
import { CreateTerminalSessionDto } from './dto/create-terminal-session.dto';
import { QueryTerminalSessionChunksDto } from './dto/query-terminal-session-chunks.dto';
import { QueryTerminalSessionsDto } from './dto/query-terminal-sessions.dto';
import { TerminateTerminalSessionDto } from './dto/terminate-terminal-session.dto';
import { TerminalSessionChunkEntity } from './entities/terminal-session-chunk.entity';
import { TerminalSessionEntity } from './entities/terminal-session.entity';
import { TerminalSessionsService } from './terminal-sessions.service';

@ApiTags('Workspace Terminal Sessions')
@ApiBearerAuth(SWAGGER_BEARER_AUTH_NAME)
@ApiUnauthorizedResponse({
  description: 'JWT authentication required.',
})
@Controller('workspaces/:workspaceId')
@UseGuards(WorkspaceMembershipGuard, WorkspaceRolesGuard)
@WorkspaceRoles(WorkspaceMembershipRole.OWNER, WorkspaceMembershipRole.ADMIN)
export class TerminalSessionsController {
  constructor(
    private readonly terminalSessionsService: TerminalSessionsService,
  ) {}

  @Post('nodes/:nodeId/terminal-sessions')
  @ApiOperation({
    summary: 'Create an interactive terminal session for a node',
  })
  @ApiCreatedResponse({
    type: TerminalSessionEntity,
  })
  create(
    @Param('workspaceId') workspaceId: string,
    @Param('nodeId') nodeId: string,
    @Body() dto: CreateTerminalSessionDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.terminalSessionsService.createSession(
      workspaceId,
      nodeId,
      dto,
      user,
      {
        actorType: 'user',
        actorUserId: user.id,
        actorEmailSnapshot: user.email,
        ipAddress: request.ip ?? null,
        userAgent: request.headers['user-agent'] ?? null,
      },
    );
  }

  @Get('nodes/:nodeId/terminal-sessions')
  @ApiOperation({
    summary: 'List terminal sessions for a node',
  })
  @ApiOkResponse({
    type: TerminalSessionEntity,
    isArray: true,
  })
  listByNode(
    @Param('workspaceId') workspaceId: string,
    @Param('nodeId') nodeId: string,
    @Query() query: QueryTerminalSessionsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.terminalSessionsService.listNodeSessions(
      workspaceId,
      nodeId,
      user,
      query,
    );
  }

  @Get('terminal-sessions/:sessionId')
  @ApiOperation({
    summary: 'Get a terminal session by ID',
  })
  @ApiOkResponse({
    type: TerminalSessionEntity,
  })
  getById(
    @Param('workspaceId') workspaceId: string,
    @Param('sessionId') sessionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.terminalSessionsService.getSession(
      workspaceId,
      sessionId,
      user,
    );
  }

  @Get('terminal-sessions/:sessionId/chunks')
  @ApiOperation({
    summary: 'List transcript chunks for a terminal session',
  })
  @ApiOkResponse({
    type: TerminalSessionChunkEntity,
    isArray: true,
  })
  getChunks(
    @Param('workspaceId') workspaceId: string,
    @Param('sessionId') sessionId: string,
    @Query() query: QueryTerminalSessionChunksDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.terminalSessionsService.getSessionChunks(
      workspaceId,
      sessionId,
      user,
      query,
    );
  }

  @Post('terminal-sessions/:sessionId/terminate')
  @ApiOperation({
    summary: 'Terminate an active terminal session',
  })
  @ApiOkResponse({
    type: TerminalSessionEntity,
  })
  terminate(
    @Param('workspaceId') workspaceId: string,
    @Param('sessionId') sessionId: string,
    @Body() dto: TerminateTerminalSessionDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.terminalSessionsService.terminateSession(
      workspaceId,
      sessionId,
      dto,
      user,
      {
        actorType: 'user',
        actorUserId: user.id,
        actorEmailSnapshot: user.email,
        ipAddress: request.ip ?? null,
        userAgent: request.headers['user-agent'] ?? null,
      },
    );
  }
}
