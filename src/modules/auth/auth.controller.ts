import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { SWAGGER_BEARER_AUTH_NAME } from '../../common/constants/swagger.constants';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthenticatedUser } from '../../common/types/authenticated-user.type';
import { UserRole } from '../users/entities/user-role.enum';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';
import { AuthProviderOptionDto } from './dto/auth-provider-option.dto';
import { ConfirmMfaSetupDto } from './dto/confirm-mfa-setup.dto';
import { CreateOidcProviderDto } from './dto/create-oidc-provider.dto';
import { DeleteMfaDto } from './dto/delete-mfa.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { GenericAuthActionResponseDto } from './dto/generic-auth-action-response.dto';
import { InvitationPreviewDto } from './dto/invitation-preview.dto';
import { LoginDto } from './dto/login.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import { MfaSetupResponseDto } from './dto/mfa-setup-response.dto';
import { MfaStatusDto } from './dto/mfa-status.dto';
import { OidcProviderStartResponseDto } from './dto/oidc-provider-start-response.dto';
import { PasswordResetPreviewDto } from './dto/password-reset-preview.dto';
import { QueryOidcStartDto } from './dto/query-oidc-start.dto';
import { RegenerateMfaRecoveryCodesDto } from './dto/regenerate-mfa-recovery-codes.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { TestOidcProviderDto } from './dto/test-oidc-provider.dto';
import { UpdateOidcProviderDto } from './dto/update-oidc-provider.dto';
import { VerifyMfaChallengeDto } from './dto/verify-mfa-challenge.dto';
import { VerifyMfaRecoveryDto } from './dto/verify-mfa-recovery.dto';
import { OidcProviderEntity } from './entities/oidc-provider.entity';
import { AuthService } from './auth.service';

@ApiTags('Auth')
@ApiBearerAuth(SWAGGER_BEARER_AUTH_NAME)
@ApiUnauthorizedResponse({
  description: 'JWT authentication required.',
})
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Authenticate with email and password',
    description:
      'Returns either a JWT access token or a short-lived MFA challenge token when the account requires a second factor.',
  })
  @ApiBody({ type: LoginDto })
  @ApiOkResponse({
    description: 'Successful login or MFA challenge response.',
    type: LoginResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid email or password.',
  })
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Public()
  @Get('providers')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'List enabled public auth providers',
  })
  @ApiOkResponse({
    type: AuthProviderOptionDto,
    isArray: true,
  })
  getPublicProviders() {
    return this.authService.getPublicAuthProviders();
  }

  @Roles(UserRole.PLATFORM_ADMIN)
  @Get('providers/admin')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'List configured OIDC providers',
  })
  @ApiOkResponse({
    type: OidcProviderEntity,
    isArray: true,
  })
  listOidcProviders() {
    return this.authService.listOidcProviders();
  }

  @Roles(UserRole.PLATFORM_ADMIN)
  @Post('providers')
  @ApiCreatedResponse({
    type: OidcProviderEntity,
  })
  createOidcProvider(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateOidcProviderDto,
  ) {
    return this.authService.createOidcProvider(dto, actor);
  }

  @Roles(UserRole.PLATFORM_ADMIN)
  @Patch('providers/:providerId')
  @ApiOkResponse({
    type: OidcProviderEntity,
  })
  updateOidcProvider(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('providerId') providerId: string,
    @Body() dto: UpdateOidcProviderDto,
  ) {
    return this.authService.updateOidcProvider(providerId, dto, actor);
  }

  @Roles(UserRole.PLATFORM_ADMIN)
  @Delete('providers/:providerId')
  @ApiOkResponse({
    schema: {
      example: {
        deleted: true,
        id: 'provider-id',
      },
    },
  })
  deleteOidcProvider(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('providerId') providerId: string,
  ) {
    return this.authService.deleteOidcProvider(providerId, actor);
  }

  @Roles(UserRole.PLATFORM_ADMIN)
  @Post('providers/test')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({
    schema: {
      example: {
        success: true,
        issuer: 'https://accounts.google.com',
        authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenEndpoint: 'https://oauth2.googleapis.com/token',
        userinfoEndpoint: 'https://openidconnect.googleapis.com/v1/userinfo',
      },
    },
  })
  testOidcProvider(@Body() dto: TestOidcProviderDto) {
    return this.authService.testOidcProvider(dto);
  }

  @Public()
  @Get('oidc/:provider/start')
  @Header('Cache-Control', 'no-store')
  @ApiParam({
    name: 'provider',
    example: 'google',
  })
  @ApiOperation({
    summary: 'Prepare an OIDC authorization redirect',
  })
  @ApiOkResponse({
    type: OidcProviderStartResponseDto,
  })
  startOidcLogin(
    @Param('provider') provider: string,
    @Query() query: QueryOidcStartDto,
  ) {
    return this.authService.startOidcLogin(provider, query);
  }

  @Public()
  @Get('oidc/:provider/callback')
  @Header('Cache-Control', 'no-store')
  @ApiParam({
    name: 'provider',
    example: 'google',
  })
  @ApiQuery({ name: 'code', required: false })
  @ApiQuery({ name: 'state', required: false })
  @ApiQuery({ name: 'error', required: false })
  @ApiQuery({ name: 'error_description', required: false })
  @ApiOkResponse({
    type: LoginResponseDto,
  })
  handleOidcCallback(
    @Param('provider') provider: string,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
    @Query('error_description') errorDescription?: string,
  ) {
    return this.authService.handleOidcCallback({
      providerSlug: provider,
      code,
      state,
      error,
      errorDescription,
    });
  }

  @Post('mfa/setup/initiate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Start MFA enrollment for the current user',
  })
  @ApiOkResponse({
    type: MfaSetupResponseDto,
  })
  initiateMfaSetup(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.initiateMfaSetup(user.id);
  }

  @Post('mfa/setup/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirm MFA enrollment and issue recovery codes',
  })
  @ApiOkResponse({
    type: MfaStatusDto,
  })
  confirmMfaSetup(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ConfirmMfaSetupDto,
  ) {
    return this.authService.confirmMfaSetup(user.id, dto);
  }

  @Public()
  @Post('mfa/challenge/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Finish MFA verification using an authenticator code',
  })
  @ApiOkResponse({
    type: LoginResponseDto,
  })
  verifyMfaChallenge(@Body() dto: VerifyMfaChallengeDto) {
    return this.authService.verifyMfaChallenge(dto);
  }

  @Public()
  @Post('mfa/recovery/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Finish MFA verification using a recovery code',
  })
  @ApiOkResponse({
    type: LoginResponseDto,
  })
  verifyMfaRecovery(@Body() dto: VerifyMfaRecoveryDto) {
    return this.authService.verifyMfaRecovery(dto);
  }

  @Post('mfa/recovery/regenerate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Regenerate MFA recovery codes for the current user',
  })
  @ApiOkResponse({
    type: MfaStatusDto,
  })
  regenerateMfaRecoveryCodes(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RegenerateMfaRecoveryCodesDto,
  ) {
    return this.authService.regenerateMfaRecoveryCodes(user.id, dto);
  }

  @Delete('mfa')
  @ApiOperation({
    summary: 'Disable MFA for the current user',
  })
  @ApiOkResponse({
    schema: {
      example: {
        success: true,
      },
    },
  })
  disableMfa(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: DeleteMfaDto,
  ) {
    return this.authService.disableMfa(user.id, dto);
  }

  @Public()
  @Get('invitations/:token')
  @ApiParam({
    name: 'token',
    example: 'invite-token',
  })
  @ApiOkResponse({
    type: InvitationPreviewDto,
  })
  getInvitationPreview(@Param('token') token: string) {
    return this.authService.getInvitationPreview(token);
  }

  @Public()
  @Post('invitations/:token/accept')
  @HttpCode(HttpStatus.OK)
  @ApiParam({
    name: 'token',
    example: 'invite-token',
  })
  @ApiBody({ type: AcceptInvitationDto })
  @ApiOkResponse({
    type: GenericAuthActionResponseDto,
  })
  acceptInvitation(
    @Param('token') token: string,
    @Body() body: AcceptInvitationDto,
  ) {
    return this.authService.acceptInvitation(token, body.password);
  }

  @Public()
  @Post('password/forgot')
  @HttpCode(HttpStatus.OK)
  @ApiBody({ type: ForgotPasswordDto })
  @ApiOkResponse({
    type: GenericAuthActionResponseDto,
  })
  forgotPassword(@Body() body: ForgotPasswordDto) {
    return this.authService.requestPasswordReset(body.email);
  }

  @Public()
  @Get('password/reset/:token')
  @ApiParam({
    name: 'token',
    example: 'reset-token',
  })
  @ApiOkResponse({
    type: PasswordResetPreviewDto,
  })
  getPasswordResetPreview(@Param('token') token: string) {
    return this.authService.getPasswordResetPreview(token);
  }

  @Public()
  @Post('password/reset/:token')
  @HttpCode(HttpStatus.OK)
  @ApiParam({
    name: 'token',
    example: 'reset-token',
  })
  @ApiBody({ type: ResetPasswordDto })
  @ApiOkResponse({
    type: GenericAuthActionResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Password reset token was invalid or expired.',
  })
  resetPassword(@Param('token') token: string, @Body() body: ResetPasswordDto) {
    return this.authService.resetPassword(token, body.password);
  }
}
