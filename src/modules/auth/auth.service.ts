import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { AuthenticatedUser } from '../../common/types/authenticated-user.type';
import { JwtPayload } from '../../common/types/jwt-payload.type';
import {
  decryptSecretValue,
  encryptSecretValue,
} from '../../common/utils/secrets.util';
import {
  buildTotpOtpauthUrl,
  generateRecoveryCodes,
  generateTotpSecret,
  verifyTotpToken,
} from '../../common/utils/totp.util';
import { AUTH_CONFIG_KEY, authConfig } from '../../config';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { UserEntity } from '../users/entities/user.entity';
import { UserInvitationStatus } from '../users/entities/user-invitation.entity';
import { UsersService } from '../users/users.service';
import { AuthProviderOptionDto } from './dto/auth-provider-option.dto';
import { ConfirmMfaSetupDto } from './dto/confirm-mfa-setup.dto';
import { CreateOidcProviderDto } from './dto/create-oidc-provider.dto';
import { DeleteMfaDto } from './dto/delete-mfa.dto';
import { LoginDto } from './dto/login.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import { MfaSetupResponseDto } from './dto/mfa-setup-response.dto';
import { MfaStatusDto } from './dto/mfa-status.dto';
import { OidcProviderStartResponseDto } from './dto/oidc-provider-start-response.dto';
import { QueryOidcStartDto } from './dto/query-oidc-start.dto';
import { RegenerateMfaRecoveryCodesDto } from './dto/regenerate-mfa-recovery-codes.dto';
import { TestOidcProviderDto } from './dto/test-oidc-provider.dto';
import { UpdateOidcProviderDto } from './dto/update-oidc-provider.dto';
import { VerifyMfaChallengeDto } from './dto/verify-mfa-challenge.dto';
import { VerifyMfaRecoveryDto } from './dto/verify-mfa-recovery.dto';
import { OidcIdentityEntity } from './entities/oidc-identity.entity';
import { OidcProviderEntity } from './entities/oidc-provider.entity';

const MFA_CHALLENGE_EXPIRY = '10m';
const OIDC_STATE_EXPIRY = '10m';
const TOTP_ISSUER = 'Noderax';
const OIDC_DEFAULT_SCOPES = ['openid', 'email', 'profile'];
type JoseModule = typeof import('jose');
const importEsmModule = new Function(
  'specifier',
  'return import(specifier)',
) as <T>(specifier: string) => Promise<T>;

let joseModulePromise: Promise<JoseModule> | null = null;

type MfaChallengePayload = JwtPayload & {
  type: 'mfa_challenge';
};

type OidcStatePayload = {
  type: 'oidc_state';
  providerId: string;
  redirectUri: string;
  next?: string | null;
};

type OidcDiscoveryDocument = {
  issuer?: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  userinfo_endpoint?: string;
  jwks_uri?: string;
};

type OidcTokenResponse = {
  access_token?: string;
  id_token?: string;
  token_type?: string;
};

type OidcProfile = {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  preferred_username?: string;
};

const OIDC_PRESETS: Record<
  'google' | 'microsoft',
  {
    issuer: string;
    discoveryUrl: string;
    scopes: string[];
  }
> = {
  google: {
    issuer: 'https://accounts.google.com',
    discoveryUrl:
      'https://accounts.google.com/.well-known/openid-configuration',
    scopes: [...OIDC_DEFAULT_SCOPES],
  },
  microsoft: {
    issuer: 'https://login.microsoftonline.com/common/v2.0',
    discoveryUrl:
      'https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration',
    scopes: [...OIDC_DEFAULT_SCOPES],
  },
};

async function loadJoseModule() {
  if (!joseModulePromise) {
    joseModulePromise = importEsmModule<JoseModule>('jose');
  }

  return joseModulePromise;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
    @InjectRepository(OidcProviderEntity)
    private readonly oidcProvidersRepository: Repository<OidcProviderEntity>,
    @InjectRepository(OidcIdentityEntity)
    private readonly oidcIdentitiesRepository: Repository<OidcIdentityEntity>,
    private readonly auditLogsService: AuditLogsService,
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

    if (user.mfaEnabled) {
      return {
        requiresMfa: true,
        mfaChallengeToken: await this.createMfaChallengeToken(user),
        expiresIn: MFA_CHALLENGE_EXPIRY,
        user: this.usersService.toResponse(user),
      };
    }

    return this.createAccessSession(user);
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

    if (
      !user ||
      !user.isActive ||
      user.sessionVersion !== payload.sessionVersion
    ) {
      throw new UnauthorizedException('Invalid authentication token');
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      sessionVersion: user.sessionVersion,
    };
  }

  async initiateMfaSetup(userId: string): Promise<MfaSetupResponseDto> {
    const user = await this.loadUserWithMfa(userId);
    const secret = generateTotpSecret();

    user.mfaPendingSecretEncrypted = this.encrypt(secret);
    await this.usersRepository.save(user);

    return {
      secret,
      otpauthUrl: buildTotpOtpauthUrl({
        issuer: TOTP_ISSUER,
        accountName: user.email,
        secret,
      }),
    };
  }

  async confirmMfaSetup(
    userId: string,
    dto: ConfirmMfaSetupDto,
  ): Promise<MfaStatusDto> {
    const user = await this.loadUserWithMfa(userId);

    if (!user.mfaPendingSecretEncrypted) {
      throw new BadRequestException('MFA setup has not been initiated.');
    }

    const pendingSecret = this.decrypt(user.mfaPendingSecretEncrypted);
    if (!verifyTotpToken({ secret: pendingSecret, token: dto.token })) {
      throw new BadRequestException('Invalid authenticator code.');
    }

    const recoveryCodes = generateRecoveryCodes();
    user.mfaEnabled = true;
    user.mfaSecretEncrypted = this.encrypt(pendingSecret);
    user.mfaPendingSecretEncrypted = null;
    user.mfaRecoveryCodes = this.encryptRecoveryCodes(recoveryCodes);
    user.mfaEnabledAt = new Date();
    user.sessionVersion += 1;
    await this.usersRepository.save(user);

    await this.auditLogsService.record({
      scope: 'platform',
      action: 'auth.mfa.enabled',
      targetType: 'user',
      targetId: user.id,
      targetLabel: user.email,
      context: {
        actorType: 'user',
        actorUserId: user.id,
        actorEmailSnapshot: user.email,
      },
    });

    return {
      mfaEnabled: true,
      recoveryCodes,
    };
  }

  async verifyMfaChallenge(
    dto: VerifyMfaChallengeDto,
  ): Promise<LoginResponseDto> {
    const user = await this.verifyMfaChallengeToken(dto.challengeToken);

    if (!user.mfaEnabled || !user.mfaSecretEncrypted) {
      throw new BadRequestException('MFA is not enabled for this account.');
    }

    const secret = this.decrypt(user.mfaSecretEncrypted);
    if (!verifyTotpToken({ secret, token: dto.token })) {
      throw new UnauthorizedException('Invalid authenticator code.');
    }

    return this.createAccessSession(user);
  }

  async verifyMfaRecovery(
    dto: VerifyMfaRecoveryDto,
  ): Promise<LoginResponseDto> {
    const user = await this.verifyMfaChallengeToken(dto.challengeToken);
    const recoveryCodes = this.decryptRecoveryCodes(user.mfaRecoveryCodes);
    const normalizedCode = this.normalizeRecoveryCode(dto.recoveryCode);
    const matchingIndex = recoveryCodes.findIndex(
      (entry) => this.normalizeRecoveryCode(entry) === normalizedCode,
    );

    if (matchingIndex === -1) {
      throw new UnauthorizedException('Invalid recovery code.');
    }

    recoveryCodes.splice(matchingIndex, 1);
    user.mfaRecoveryCodes = this.encryptRecoveryCodes(recoveryCodes);
    await this.usersRepository.save(user);

    return this.createAccessSession(user);
  }

  async regenerateMfaRecoveryCodes(
    userId: string,
    dto: RegenerateMfaRecoveryCodesDto,
  ): Promise<MfaStatusDto> {
    const user = await this.loadUserWithMfa(userId);

    if (!user.mfaEnabled || !user.mfaSecretEncrypted) {
      throw new BadRequestException('MFA is not enabled for this account.');
    }

    const secret = this.decrypt(user.mfaSecretEncrypted);
    if (!verifyTotpToken({ secret, token: dto.token })) {
      throw new UnauthorizedException('Invalid authenticator code.');
    }

    const recoveryCodes = generateRecoveryCodes();
    user.mfaRecoveryCodes = this.encryptRecoveryCodes(recoveryCodes);
    user.sessionVersion += 1;
    await this.usersRepository.save(user);

    await this.auditLogsService.record({
      scope: 'platform',
      action: 'auth.mfa.recovery-codes.regenerated',
      targetType: 'user',
      targetId: user.id,
      targetLabel: user.email,
      context: {
        actorType: 'user',
        actorUserId: user.id,
        actorEmailSnapshot: user.email,
      },
    });

    return {
      mfaEnabled: true,
      recoveryCodes,
    };
  }

  async disableMfa(
    userId: string,
    dto: DeleteMfaDto,
  ): Promise<{ success: true }> {
    const user = await this.loadUserWithMfa(userId);

    if (!user.mfaEnabled || !user.mfaSecretEncrypted) {
      return { success: true };
    }

    const secret = this.decrypt(user.mfaSecretEncrypted);
    if (!verifyTotpToken({ secret, token: dto.token })) {
      throw new UnauthorizedException('Invalid authenticator code.');
    }

    user.mfaEnabled = false;
    user.mfaSecretEncrypted = null;
    user.mfaPendingSecretEncrypted = null;
    user.mfaRecoveryCodes = null;
    user.mfaEnabledAt = null;
    user.sessionVersion += 1;
    await this.usersRepository.save(user);

    await this.auditLogsService.record({
      scope: 'platform',
      action: 'auth.mfa.disabled',
      targetType: 'user',
      targetId: user.id,
      targetLabel: user.email,
      context: {
        actorType: 'user',
        actorUserId: user.id,
        actorEmailSnapshot: user.email,
      },
    });

    return { success: true };
  }

  async getPublicAuthProviders(): Promise<AuthProviderOptionDto[]> {
    const providers = await this.oidcProvidersRepository.find({
      where: { enabled: true },
      order: { name: 'ASC' },
    });

    return providers.map((provider) => ({
      slug: provider.slug,
      name: provider.name,
      preset: provider.preset,
    }));
  }

  listOidcProviders() {
    return this.oidcProvidersRepository.find({
      order: { name: 'ASC' },
    });
  }

  async createOidcProvider(
    dto: CreateOidcProviderDto,
    actor: AuthenticatedUser,
  ) {
    const normalized = this.normalizeOidcProviderInput(dto);
    await this.assertOidcProviderSlugAvailable(normalized.slug);
    await this.ensureOidcDiscoveryReachable({
      issuer: normalized.issuer,
      discoveryUrl: normalized.discoveryUrl,
    });

    const provider = this.oidcProvidersRepository.create({
      slug: normalized.slug,
      name: normalized.name,
      preset: normalized.preset ?? null,
      issuer: normalized.issuer,
      clientId: normalized.clientId,
      clientSecretEncrypted: normalized.clientSecret
        ? this.encrypt(normalized.clientSecret)
        : null,
      discoveryUrl: normalized.discoveryUrl,
      scopes: normalized.scopes,
      enabled: normalized.enabled,
    });

    const saved = await this.oidcProvidersRepository.save(provider);

    await this.auditLogsService.record({
      scope: 'platform',
      action: 'auth.oidc-provider.created',
      targetType: 'oidc_provider',
      targetId: saved.id,
      targetLabel: saved.name,
      metadata: {
        slug: saved.slug,
        enabled: saved.enabled,
      },
      context: {
        actorType: 'user',
        actorUserId: actor.id,
        actorEmailSnapshot: actor.email,
      },
    });

    return saved;
  }

  async updateOidcProvider(
    providerId: string,
    dto: UpdateOidcProviderDto,
    actor: AuthenticatedUser,
  ) {
    const provider = await this.getOidcProviderOrFail(providerId, true);
    const before = {
      name: provider.name,
      enabled: provider.enabled,
      slug: provider.slug,
    };

    const normalized = this.normalizeOidcProviderInput({
      slug: dto.slug ?? provider.slug,
      name: dto.name ?? provider.name,
      preset:
        dto.preset ??
        ((provider.preset === 'google' || provider.preset === 'microsoft'
          ? provider.preset
          : undefined) as 'google' | 'microsoft' | undefined),
      issuer: dto.issuer ?? provider.issuer,
      clientId: dto.clientId ?? provider.clientId,
      clientSecret: dto.clientSecret,
      discoveryUrl: dto.discoveryUrl ?? provider.discoveryUrl,
      scopes: dto.scopes ?? provider.scopes,
      enabled: dto.enabled ?? provider.enabled,
    });

    if (normalized.slug !== provider.slug) {
      await this.assertOidcProviderSlugAvailable(normalized.slug, provider.id);
    }
    await this.ensureOidcDiscoveryReachable({
      issuer: normalized.issuer,
      discoveryUrl: normalized.discoveryUrl,
    });

    provider.slug = normalized.slug;
    provider.name = normalized.name;
    provider.preset = normalized.preset ?? null;
    provider.issuer = normalized.issuer;
    provider.clientId = normalized.clientId;
    provider.discoveryUrl = normalized.discoveryUrl;
    provider.scopes = normalized.scopes;
    provider.enabled = normalized.enabled;
    if (dto.clientSecret !== undefined) {
      provider.clientSecretEncrypted = dto.clientSecret
        ? this.encrypt(dto.clientSecret)
        : null;
    }

    const saved = await this.oidcProvidersRepository.save(provider);

    await this.auditLogsService.record({
      scope: 'platform',
      action: 'auth.oidc-provider.updated',
      targetType: 'oidc_provider',
      targetId: saved.id,
      targetLabel: saved.name,
      changes: {
        before,
        after: {
          name: saved.name,
          enabled: saved.enabled,
          slug: saved.slug,
        },
      },
      context: {
        actorType: 'user',
        actorUserId: actor.id,
        actorEmailSnapshot: actor.email,
      },
    });

    return saved;
  }

  async deleteOidcProvider(providerId: string, actor: AuthenticatedUser) {
    const provider = await this.getOidcProviderOrFail(providerId);
    await this.oidcProvidersRepository.remove(provider);

    await this.auditLogsService.record({
      scope: 'platform',
      action: 'auth.oidc-provider.deleted',
      targetType: 'oidc_provider',
      targetId: provider.id,
      targetLabel: provider.name,
      context: {
        actorType: 'user',
        actorUserId: actor.id,
        actorEmailSnapshot: actor.email,
      },
    });

    return {
      deleted: true as const,
      id: provider.id,
    };
  }

  async testOidcProvider(dto: TestOidcProviderDto) {
    const normalized = this.normalizeOidcProviderInput({
      slug: 'draft-provider',
      name: 'Draft Provider',
      ...dto,
    });
    const discovery = await this.fetchOidcDiscoveryDocument(
      normalized.discoveryUrl,
    );

    if (!discovery.authorization_endpoint || !discovery.token_endpoint) {
      throw new BadRequestException(
        'OIDC discovery document is missing required endpoints.',
      );
    }

    if (discovery.issuer && discovery.issuer !== normalized.issuer) {
      throw new BadRequestException(
        'OIDC discovery issuer does not match the configured issuer.',
      );
    }

    return {
      success: true as const,
      issuer: discovery.issuer ?? normalized.issuer,
      authorizationEndpoint: discovery.authorization_endpoint,
      tokenEndpoint: discovery.token_endpoint,
      userinfoEndpoint: discovery.userinfo_endpoint ?? null,
    };
  }

  async startOidcLogin(
    providerSlug: string,
    query: QueryOidcStartDto,
  ): Promise<OidcProviderStartResponseDto> {
    const provider = await this.getOidcProviderBySlugOrFail(providerSlug);
    const discovery = await this.fetchOidcDiscoveryDocument(
      provider.discoveryUrl,
    );

    if (!discovery.authorization_endpoint) {
      throw new BadRequestException(
        'OIDC discovery document is missing an authorization endpoint.',
      );
    }

    const state = await this.jwtService.signAsync(
      {
        type: 'oidc_state',
        providerId: provider.id,
        redirectUri: query.redirectUri,
        next: query.next ?? null,
      } satisfies OidcStatePayload,
      {
        expiresIn: OIDC_STATE_EXPIRY,
      },
    );

    const authorizationUrl = new URL(discovery.authorization_endpoint);
    authorizationUrl.searchParams.set('client_id', provider.clientId);
    authorizationUrl.searchParams.set('response_type', 'code');
    authorizationUrl.searchParams.set('redirect_uri', query.redirectUri);
    authorizationUrl.searchParams.set(
      'scope',
      provider.scopes?.length
        ? provider.scopes.join(' ')
        : 'openid email profile',
    );
    authorizationUrl.searchParams.set('state', state);

    return {
      authorizationUrl: authorizationUrl.toString(),
    };
  }

  async handleOidcCallback(input: {
    providerSlug: string;
    code?: string;
    state?: string;
    error?: string;
    errorDescription?: string;
  }): Promise<LoginResponseDto> {
    if (input.error) {
      throw new UnauthorizedException(
        input.errorDescription ?? `OIDC sign-in failed: ${input.error}`,
      );
    }

    if (!input.code || !input.state) {
      throw new BadRequestException('OIDC callback is missing code or state.');
    }

    const statePayload = await this.verifyOidcStateToken(input.state);
    const provider = await this.getOidcProviderBySlugOrFail(input.providerSlug);

    if (statePayload.providerId !== provider.id) {
      throw new UnauthorizedException(
        'OIDC state token does not match provider.',
      );
    }

    const discovery = await this.fetchOidcDiscoveryDocument(
      provider.discoveryUrl,
    );
    const tokenResponse = await this.exchangeOidcCode({
      provider,
      discovery,
      code: input.code,
      redirectUri: statePayload.redirectUri,
    });
    const profile = await this.resolveOidcProfile({
      provider,
      discovery,
      tokenResponse,
    });
    const email = profile.email?.trim().toLowerCase();

    if (!email || profile.email_verified !== true) {
      throw new ForbiddenException(
        'Single sign-on requires a verified email address from the identity provider.',
      );
    }

    const user = await this.usersService.findByEmail(email);
    if (
      !user ||
      !user.isActive ||
      user.inviteStatus !== UserInvitationStatus.ACCEPTED
    ) {
      throw new ForbiddenException(
        'Single sign-on is only available to existing active users.',
      );
    }

    if (!profile.sub?.trim()) {
      throw new ForbiddenException(
        'Identity provider response is missing a subject identifier.',
      );
    }

    const existingIdentity = await this.oidcIdentitiesRepository.findOne({
      where: {
        providerId: provider.id,
        subject: profile.sub.trim(),
      },
    });

    if (existingIdentity && existingIdentity.userId !== user.id) {
      throw new ConflictException(
        'This identity provider account is already linked to another user.',
      );
    }

    if (!existingIdentity) {
      await this.oidcIdentitiesRepository.save(
        this.oidcIdentitiesRepository.create({
          providerId: provider.id,
          userId: user.id,
          subject: profile.sub.trim(),
          email,
        }),
      );

      await this.auditLogsService.record({
        scope: 'platform',
        action: 'auth.oidc.identity.linked',
        targetType: 'user',
        targetId: user.id,
        targetLabel: user.email,
        metadata: {
          providerId: provider.id,
          providerSlug: provider.slug,
        },
        context: {
          actorType: 'user',
          actorUserId: user.id,
          actorEmailSnapshot: user.email,
        },
      });
    }

    return this.createAccessSession(user, {
      redirectPath: statePayload.next ?? null,
    });
  }

  getInvitationPreview(token: string) {
    return this.usersService.getInvitationPreview(token);
  }

  acceptInvitation(token: string, password: string) {
    return this.usersService.acceptInvitation(token, password);
  }

  requestPasswordReset(email: string) {
    return this.usersService.requestPasswordReset(email);
  }

  getPasswordResetPreview(token: string) {
    return this.usersService.getPasswordResetPreview(token);
  }

  resetPassword(token: string, password: string) {
    return this.usersService.resetPassword(token, password);
  }

  private async createAccessSession(
    user: UserEntity,
    options?: { redirectPath?: string | null },
  ): Promise<LoginResponseDto> {
    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      sessionVersion: user.sessionVersion,
    });
    const authSettings =
      this.configService.getOrThrow<ConfigType<typeof authConfig>>(
        AUTH_CONFIG_KEY,
      );

    await this.auditLogsService.record({
      scope: 'platform',
      action: 'auth.login.success',
      targetType: 'user',
      targetId: user.id,
      targetLabel: user.email,
      context: {
        actorType: 'user',
        actorUserId: user.id,
        actorEmailSnapshot: user.email,
      },
    });

    return {
      accessToken,
      expiresIn: authSettings.jwtExpiresIn,
      user: this.usersService.toResponse(user),
      redirectPath: options?.redirectPath ?? null,
    };
  }

  private async createMfaChallengeToken(user: UserEntity) {
    return this.jwtService.signAsync(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
        sessionVersion: user.sessionVersion,
        type: 'mfa_challenge',
      } satisfies MfaChallengePayload,
      {
        expiresIn: MFA_CHALLENGE_EXPIRY,
      },
    );
  }

  private async verifyMfaChallengeToken(token: string): Promise<UserEntity> {
    try {
      const payload =
        await this.jwtService.verifyAsync<MfaChallengePayload>(token);

      if (payload.type !== 'mfa_challenge') {
        throw new UnauthorizedException('Invalid MFA challenge token.');
      }

      const user = await this.loadUserWithMfa(payload.sub);
      if (!user.isActive || user.sessionVersion !== payload.sessionVersion) {
        throw new UnauthorizedException('Invalid MFA challenge token.');
      }

      return user;
    } catch (error) {
      throw this.createTokenVerificationException(error);
    }
  }

  private async verifyOidcStateToken(token: string): Promise<OidcStatePayload> {
    try {
      const payload =
        await this.jwtService.verifyAsync<OidcStatePayload>(token);

      if (payload.type !== 'oidc_state') {
        throw new UnauthorizedException('Invalid OIDC state token.');
      }

      return payload;
    } catch (error) {
      throw this.createTokenVerificationException(error);
    }
  }

  private async loadUserWithMfa(userId: string): Promise<UserEntity> {
    const user = await this.usersRepository
      .createQueryBuilder('user')
      .addSelect('user.mfaSecretEncrypted')
      .addSelect('user.mfaPendingSecretEncrypted')
      .addSelect('user.mfaRecoveryCodes')
      .where('user.id = :userId', { userId })
      .getOne();

    if (!user) {
      throw new NotFoundException(`User ${userId} was not found`);
    }

    return user;
  }

  private normalizeOidcProviderInput(input: {
    slug: string;
    name: string;
    preset?: 'google' | 'microsoft';
    issuer: string;
    clientId: string;
    clientSecret?: string;
    discoveryUrl: string;
    scopes?: string[];
    enabled?: boolean;
  }) {
    const preset = input.preset;
    const presetDefaults = preset ? OIDC_PRESETS[preset] : null;

    return {
      slug: input.slug.trim().toLowerCase(),
      name: input.name.trim(),
      preset,
      issuer: (input.issuer || presetDefaults?.issuer || '').trim(),
      clientId: input.clientId.trim(),
      clientSecret: input.clientSecret?.trim() ?? '',
      discoveryUrl: (
        input.discoveryUrl ||
        presetDefaults?.discoveryUrl ||
        ''
      ).trim(),
      scopes: input.scopes?.length
        ? input.scopes.map((scope) => scope.trim()).filter(Boolean)
        : (presetDefaults?.scopes ?? [...OIDC_DEFAULT_SCOPES]),
      enabled: input.enabled ?? true,
    };
  }

  private async assertOidcProviderSlugAvailable(
    slug: string,
    excludeProviderId?: string,
  ) {
    const existing = await this.oidcProvidersRepository.findOne({
      where: { slug },
    });

    if (existing && existing.id !== excludeProviderId) {
      throw new ConflictException(
        'An identity provider with this slug already exists.',
      );
    }
  }

  private async getOidcProviderOrFail(
    providerId: string,
    includeSecret = false,
  ) {
    const query = this.oidcProvidersRepository
      .createQueryBuilder('provider')
      .where('provider.id = :providerId', { providerId });

    if (includeSecret) {
      query.addSelect('provider.clientSecretEncrypted');
    }

    const provider = await query.getOne();
    if (!provider) {
      throw new NotFoundException(`OIDC provider ${providerId} was not found.`);
    }

    return provider;
  }

  private async getOidcProviderBySlugOrFail(providerSlug: string) {
    const provider = await this.oidcProvidersRepository
      .createQueryBuilder('provider')
      .addSelect('provider.clientSecretEncrypted')
      .where('provider.slug = :providerSlug', {
        providerSlug: providerSlug.trim().toLowerCase(),
      })
      .andWhere('provider.enabled = true')
      .getOne();

    if (!provider) {
      throw new NotFoundException(
        `OIDC provider ${providerSlug} was not found.`,
      );
    }

    return provider;
  }

  private async ensureOidcDiscoveryReachable(input: {
    issuer: string;
    discoveryUrl: string;
  }) {
    const discovery = await this.fetchOidcDiscoveryDocument(input.discoveryUrl);
    if (!discovery.authorization_endpoint || !discovery.token_endpoint) {
      throw new BadRequestException(
        'OIDC discovery document is missing required endpoints.',
      );
    }

    if (discovery.issuer && discovery.issuer !== input.issuer) {
      throw new BadRequestException(
        'OIDC discovery issuer does not match the configured issuer.',
      );
    }
  }

  private async fetchOidcDiscoveryDocument(discoveryUrl: string) {
    const response = await fetch(discoveryUrl, {
      headers: {
        accept: 'application/json',
      },
    }).catch(() => null);

    if (!response?.ok) {
      throw new BadRequestException(
        'Unable to fetch the OIDC discovery document.',
      );
    }

    return (await response.json()) as OidcDiscoveryDocument;
  }

  private async exchangeOidcCode(input: {
    provider: OidcProviderEntity;
    discovery: OidcDiscoveryDocument;
    code: string;
    redirectUri: string;
  }) {
    if (!input.discovery.token_endpoint) {
      throw new BadRequestException(
        'OIDC discovery document is missing a token endpoint.',
      );
    }

    const response = await fetch(input.discovery.token_endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: input.code,
        redirect_uri: input.redirectUri,
        client_id: input.provider.clientId,
        ...(input.provider.clientSecretEncrypted
          ? {
              client_secret: this.decrypt(input.provider.clientSecretEncrypted),
            }
          : {}),
      }),
    }).catch(() => null);

    if (!response?.ok) {
      throw new UnauthorizedException('OIDC token exchange failed.');
    }

    return (await response.json()) as OidcTokenResponse;
  }

  private async resolveOidcProfile(input: {
    provider: OidcProviderEntity;
    discovery: OidcDiscoveryDocument;
    tokenResponse: OidcTokenResponse;
  }) {
    const idToken = input.tokenResponse.id_token;
    if (idToken && input.discovery.jwks_uri) {
      const { createRemoteJWKSet, jwtVerify } = await loadJoseModule();
      const jwks = createRemoteJWKSet(new URL(input.discovery.jwks_uri));
      const verified = await jwtVerify(idToken, jwks, {
        issuer: input.provider.issuer,
        audience: input.provider.clientId,
      }).catch(() => null);

      if (verified?.payload) {
        return verified.payload as OidcProfile;
      }
    }

    if (
      !input.discovery.userinfo_endpoint ||
      !input.tokenResponse.access_token
    ) {
      throw new ForbiddenException(
        'Identity provider response is missing profile information.',
      );
    }

    const response = await fetch(input.discovery.userinfo_endpoint, {
      headers: {
        authorization: `Bearer ${input.tokenResponse.access_token}`,
        accept: 'application/json',
      },
    }).catch(() => null);

    if (!response?.ok) {
      throw new ForbiddenException(
        'Unable to load the user profile from the identity provider.',
      );
    }

    return (await response.json()) as OidcProfile;
  }

  private encrypt(value: string) {
    const authSettings =
      this.configService.getOrThrow<ConfigType<typeof authConfig>>(
        AUTH_CONFIG_KEY,
      );

    if (!authSettings.secretsEncryptionKey?.trim()) {
      throw new InternalServerErrorException(
        'SECRETS_ENCRYPTION_KEY is not configured.',
      );
    }

    return encryptSecretValue(value, authSettings.secretsEncryptionKey);
  }

  private decrypt(value: string) {
    const authSettings =
      this.configService.getOrThrow<ConfigType<typeof authConfig>>(
        AUTH_CONFIG_KEY,
      );

    if (!authSettings.secretsEncryptionKey?.trim()) {
      throw new InternalServerErrorException(
        'SECRETS_ENCRYPTION_KEY is not configured.',
      );
    }

    return decryptSecretValue(value, authSettings.secretsEncryptionKey);
  }

  private encryptRecoveryCodes(recoveryCodes: string[]) {
    return recoveryCodes.map((code) => this.encrypt(code));
  }

  private decryptRecoveryCodes(recoveryCodes: string[] | null) {
    if (!recoveryCodes?.length) {
      return [];
    }

    return recoveryCodes.map((code) => this.decrypt(code));
  }

  private normalizeRecoveryCode(value: string) {
    return value
      .replace(/[^a-zA-Z0-9]/g, '')
      .trim()
      .toUpperCase();
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

    if (error instanceof UnauthorizedException) {
      return error;
    }

    return new UnauthorizedException(
      'Authentication token could not be verified',
    );
  }
}
