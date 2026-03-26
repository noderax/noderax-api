import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { SWAGGER_BEARER_AUTH_NAME } from '../../common/constants/swagger.constants';
import { WorkspaceRoles } from '../../common/decorators/workspace-roles.decorator';
import { WorkspaceMembershipGuard } from '../../common/guards/workspace-membership.guard';
import { WorkspaceRolesGuard } from '../../common/guards/workspace-roles.guard';
import { WorkspaceMembershipRole } from '../workspaces/entities/workspace-membership-role.enum';
import { FinalizeEnrollmentDto } from './dto/finalize-enrollment.dto';
import { FinalizeEnrollmentResponseDto } from './dto/finalize-enrollment-response.dto';
import { EnrollmentsService } from './enrollments.service';

@ApiTags('Workspace Enrollments')
@ApiBearerAuth(SWAGGER_BEARER_AUTH_NAME)
@ApiUnauthorizedResponse({
  description: 'JWT authentication required.',
})
@Controller('workspaces/:workspaceId/enrollments')
@UseGuards(WorkspaceMembershipGuard)
export class WorkspaceEnrollmentsController {
  constructor(private readonly enrollmentsService: EnrollmentsService) {}

  @Post(':token/finalize')
  @UseGuards(WorkspaceRolesGuard)
  @WorkspaceRoles(WorkspaceMembershipRole.OWNER, WorkspaceMembershipRole.ADMIN)
  @ApiParam({
    name: 'token',
    example: 'nrygC4WefXwkwUfYx3Lx4Wq4vL99b2WGdo6Ru8a11ug',
  })
  @ApiOperation({
    summary: 'Finalize agent enrollment for a workspace',
  })
  @ApiCreatedResponse({
    type: FinalizeEnrollmentResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'Workspace owner or admin access required.',
  })
  finalize(
    @Param('workspaceId') workspaceId: string,
    @Param('token') token: string,
    @Body() body: FinalizeEnrollmentDto,
  ) {
    return this.enrollmentsService.finalize(token, body, workspaceId);
  }
}
