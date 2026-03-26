import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { SWAGGER_BEARER_AUTH_NAME } from '../../common/constants/swagger.constants';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../users/entities/user-role.enum';
import { EnrollmentStatusResponseDto } from './dto/enrollment-status-response.dto';
import { FinalizeEnrollmentDto } from './dto/finalize-enrollment.dto';
import { FinalizeEnrollmentResponseDto } from './dto/finalize-enrollment-response.dto';
import { InitiateEnrollmentDto } from './dto/initiate-enrollment.dto';
import { InitiateEnrollmentResponseDto } from './dto/initiate-enrollment-response.dto';
import { EnrollmentsService } from './enrollments.service';

@ApiTags('Enrollments')
@ApiExtraModels(
  InitiateEnrollmentDto,
  InitiateEnrollmentResponseDto,
  FinalizeEnrollmentDto,
  FinalizeEnrollmentResponseDto,
  EnrollmentStatusResponseDto,
)
@Controller('enrollments')
export class EnrollmentsController {
  constructor(private readonly enrollmentsService: EnrollmentsService) {}

  @Public()
  @Post('initiate')
  @ApiOperation({
    summary: 'Initiate two-step agent enrollment',
    description:
      'Called by an agent before registration is approved. Generates a short-lived enrollment token, stores only hashed token material in the database, and returns the raw token plus expiration time to the caller.',
  })
  @ApiBody({
    type: InitiateEnrollmentDto,
  })
  @ApiCreatedResponse({
    description: 'Enrollment token issued.',
    type: InitiateEnrollmentResponseDto,
  })
  initiate(@Body() body: InitiateEnrollmentDto) {
    return this.enrollmentsService.initiate(body);
  }

  @Roles(UserRole.PLATFORM_ADMIN)
  @Post(':token/finalize')
  @ApiBearerAuth(SWAGGER_BEARER_AUTH_NAME)
  @ApiUnauthorizedResponse({
    description: 'JWT authentication required.',
  })
  @ApiForbiddenResponse({
    description: 'Admin role required.',
  })
  @ApiParam({
    name: 'token',
    description:
      'Short-lived enrollment token originally returned to the agent.',
    example: 'nrygC4WefXwkwUfYx3Lx4Wq4vL99b2WGdo6Ru8a11ug',
  })
  @ApiOperation({
    summary: 'Finalize agent enrollment and create a node',
    description:
      'Admin-only endpoint used by the web app. If the token is still pending, unexpired, and matches the provided email, the API creates a node, issues a fresh agentToken, and marks the enrollment as approved.',
  })
  @ApiBody({
    type: FinalizeEnrollmentDto,
  })
  @ApiCreatedResponse({
    description: 'Enrollment approved and node credentials issued.',
    type: FinalizeEnrollmentResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Enrollment token was not found or email did not match.',
  })
  @ApiConflictResponse({
    description: 'Enrollment token has already been approved.',
  })
  @ApiResponse({
    status: 410,
    description: 'Enrollment token expired or was revoked.',
  })
  finalize(@Param('token') token: string, @Body() body: FinalizeEnrollmentDto) {
    return this.enrollmentsService.finalize(token, body);
  }

  @Public()
  @Get(':token')
  @ApiParam({
    name: 'token',
    description:
      'Short-lived enrollment token used by the agent while polling for approval.',
    example: 'nrygC4WefXwkwUfYx3Lx4Wq4vL99b2WGdo6Ru8a11ug',
  })
  @ApiOperation({
    summary: 'Poll enrollment status',
    description:
      'Called by the agent while waiting for web approval. Pending tokens return only status, approved tokens return status plus nodeId and agentToken, and expired pending tokens are immediately revoked.',
  })
  @ApiOkResponse({
    description:
      'Current enrollment status and approved credentials when available.',
    type: EnrollmentStatusResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Enrollment token was not found.',
  })
  getStatus(@Param('token') token: string) {
    return this.enrollmentsService.getStatus(token);
  }
}
