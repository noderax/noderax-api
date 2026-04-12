import { Controller, Get, Header, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Request } from 'express';
import { SWAGGER_BEARER_AUTH_NAME } from '../../common/constants/swagger.constants';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthenticatedUser } from '../../common/types/authenticated-user.type';
import { UserRole } from '../users/entities/user-role.enum';
import { ControlPlaneUpdateSummaryDto } from './dto/control-plane-update.dto';
import { ControlPlaneUpdatesService } from './control-plane-updates.service';

@ApiTags('Control Plane Updates')
@ApiBearerAuth(SWAGGER_BEARER_AUTH_NAME)
@ApiUnauthorizedResponse({
  description: 'JWT authentication required.',
})
@Roles(UserRole.PLATFORM_ADMIN)
@Controller('control-plane-updates')
export class ControlPlaneUpdatesController {
  constructor(
    private readonly controlPlaneUpdatesService: ControlPlaneUpdatesService,
  ) {}

  @Get('summary')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Get control-plane update summary',
  })
  @ApiOkResponse({
    type: ControlPlaneUpdateSummaryDto,
  })
  getSummary() {
    return this.controlPlaneUpdatesService.getSummary();
  }

  @Post('download')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Queue the latest control-plane bundle download',
  })
  @ApiOkResponse({
    type: ControlPlaneUpdateSummaryDto,
  })
  queueDownload(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.controlPlaneUpdatesService.queueDownload({
      actorType: 'user',
      actorUserId: actor.id,
      actorEmailSnapshot: actor.email,
      ipAddress: request.ip ?? null,
      userAgent: request.headers['user-agent'] ?? null,
    });
  }

  @Post('apply')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Queue the prepared control-plane bundle apply operation',
  })
  @ApiOkResponse({
    type: ControlPlaneUpdateSummaryDto,
  })
  queueApply(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.controlPlaneUpdatesService.queueApply({
      actorType: 'user',
      actorUserId: actor.id,
      actorEmailSnapshot: actor.email,
      ipAddress: request.ip ?? null,
      userAgent: request.headers['user-agent'] ?? null,
    });
  }
}
