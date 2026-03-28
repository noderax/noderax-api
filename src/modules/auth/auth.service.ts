import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuthenticatedUser } from '../../common/types/authenticated-user.type';
import { JwtPayload } from '../../common/types/jwt-payload.type';
import { AUTH_CONFIG_KEY, authConfig } from '../../config';
import { LoginDto } from './dto/login.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import { UsersService } from '../users/users.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async login(loginDto: LoginDto): Promise<LoginResponseDto> {
    const user = await this.usersService.findByEmailWithPassword(
      loginDto.email,
    );

    if (!user?.passwordHash) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('This account is inactive.');
    }

    const passwordMatches = await bcrypt.compare(
      loginDto.password,
      user.passwordHash,
    );

    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
    });
    const authSettings =
      this.configService.getOrThrow<ConfigType<typeof authConfig>>(
        AUTH_CONFIG_KEY,
      );

    return {
      accessToken,
      expiresIn: authSettings.jwtExpiresIn,
      user: this.usersService.toResponse(user),
    };
  }

  async verifyAccessToken(accessToken: string): Promise<AuthenticatedUser> {
    try {
      const payload =
        await this.jwtService.verifyAsync<JwtPayload>(accessToken);
      return this.validateJwtPayload(payload);
    } catch (error) {
      throw this.createTokenVerificationException(error);
    }
  }

  async validateJwtPayload(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.usersService
      .findOneOrFail(payload.sub)
      .catch(() => null);

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid authentication token');
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    };
  }

  private createTokenVerificationException(
    error: unknown,
  ): UnauthorizedException {
    const errorName = error instanceof Error ? error.name : undefined;

    if (errorName === 'TokenExpiredError') {
      return new UnauthorizedException('Authentication token expired');
    }

    if (errorName === 'JsonWebTokenError' || errorName === 'NotBeforeError') {
      return new UnauthorizedException('Invalid authentication token');
    }

    return new UnauthorizedException(
      'Authentication token could not be verified',
    );
  }
}
