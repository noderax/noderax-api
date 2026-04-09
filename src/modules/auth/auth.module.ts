import { Module } from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AUTH_CONFIG_KEY, authConfig } from '../../config';
import { legacyOnlyProviders } from '../../install/legacy-bootstrap.utils';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthSchemaBootstrap } from './bootstrap/auth-schema.bootstrap';
import { OidcIdentityEntity } from './entities/oidc-identity.entity';
import { OidcProviderEntity } from './entities/oidc-provider.entity';
import { JwtStrategy } from './strategies/jwt.strategy';
import { UsersModule } from '../users/users.module';
import { UserEntity } from '../users/entities/user.entity';

@Module({
  imports: [
    UsersModule,
    AuditLogsModule,
    TypeOrmModule.forFeature([
      UserEntity,
      OidcProviderEntity,
      OidcIdentityEntity,
    ]),
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const auth =
          configService.getOrThrow<ConfigType<typeof authConfig>>(
            AUTH_CONFIG_KEY,
          );

        return {
          secret: auth.jwtSecret,
          signOptions: {
            expiresIn: auth.jwtExpiresIn as never,
          },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    ...legacyOnlyProviders([AuthSchemaBootstrap]),
  ],
  exports: [AuthService],
})
export class AuthModule {}
