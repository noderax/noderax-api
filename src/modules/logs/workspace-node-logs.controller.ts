import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Response } from 'express';
import { SWAGGER_BEARER_AUTH_NAME } from '../../common/constants/swagger.constants';
import { WorkspaceRoles } from '../../common/decorators/workspace-roles.decorator';
import { WorkspaceMembershipGuard } from '../../common/guards/workspace-membership.guard';
import { WorkspaceRolesGuard } from '../../common/guards/workspace-roles.guard';
import { WorkspaceMembershipRole } from '../workspaces/entities/workspace-membership-role.enum';
import { CreateLogPreviewDto } from './dto/create-log-preview.dto';
import { LogPreviewResponseDto } from './dto/log-preview-response.dto';
import { LogsService } from './logs.service';

@ApiTags('Workspace Node Logs')
@ApiBearerAuth(SWAGGER_BEARER_AUTH_NAME)
@ApiUnauthorizedResponse({
  description: 'JWT authentication required.',
})
@Controller('workspaces/:workspaceId/nodes/:nodeId')
@UseGuards(WorkspaceMembershipGuard, WorkspaceRolesGuard)
@WorkspaceRoles(WorkspaceMembershipRole.OWNER, WorkspaceMembershipRole.ADMIN)
export class WorkspaceNodeLogsController {
  constructor(private readonly logsService: LogsService) {}

  @Get('log-presets')
  @ApiOperation({
    summary: 'List available log source presets for a node',
  })
  @ApiOkResponse({
    description: 'Available Linux log source presets.',
  })
  listPresets() {
    return this.logsService.listPresets();
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
    const result = await this.logsService.preview(workspaceId, nodeId, dto);
    response.status(result.statusCode);
    return result.body;
  }
}
