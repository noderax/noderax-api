import { Injectable } from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { authConfig } from '../../../config';
import { JwtPayload } from '../../../common/types/jwt-payload.type';
import { AuthService } from '../auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly authService: AuthService,
  ) {
    const auth = configService.getOrThrow<ConfigType<typeof authConfig>>(
      authConfig.KEY,
    );

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: auth.jwtSecret,
    });
  }

  async validate(payload: JwtPayload) {
    return this.authService.validateJwtPayload(payload);
  }
}
