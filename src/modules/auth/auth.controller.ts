import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { AuthService } from './auth.service';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { GenericAuthActionResponseDto } from './dto/generic-auth-action-response.dto';
import { InvitationPreviewDto } from './dto/invitation-preview.dto';
import { LoginDto } from './dto/login.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import { PasswordResetPreviewDto } from './dto/password-reset-preview.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Authenticate with email and password',
    description:
      'Returns a JWT access token and the authenticated user profile.',
  })
  @ApiBody({ type: LoginDto })
  @ApiOkResponse({
    description: 'Successful login response.',
    type: LoginResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid email or password.',
  })
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
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
  resetPassword(@Param('token') token: string, @Body() body: ResetPasswordDto) {
    return this.authService.resetPassword(token, body.password);
  }
}
