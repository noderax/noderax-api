import {
  ConflictException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { Repository } from 'typeorm';
import { AGENTS_CONFIG_KEY, agentsConfig } from '../../config';
import { PUBSUB_CHANNELS } from '../../common/constants/pubsub.constants';
import { RedisService } from '../../redis/redis.service';
import { NodesService } from '../nodes/nodes.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { OutboxService } from '../outbox/outbox.service';
import { UsersService } from '../users/users.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { ConsumeNodeInstallDto } from './dto/consume-node-install.dto';
import { ConsumeNodeInstallResponseDto } from './dto/consume-node-install-response.dto';
import { CreateNodeInstallDto } from './dto/create-node-install.dto';
import { CreateNodeInstallResponseDto } from './dto/create-node-install-response.dto';
import { FinalizeEnrollmentDto } from './dto/finalize-enrollment.dto';
import { FinalizeEnrollmentResponseDto } from './dto/finalize-enrollment-response.dto';
import { EnrollmentStatusResponseDto } from './dto/enrollment-status-response.dto';
import { InitiateEnrollmentDto } from './dto/initiate-enrollment.dto';
import { InitiateEnrollmentResponseDto } from './dto/initiate-enrollment-response.dto';
import { NodeInstallStatusResponseDto } from './dto/node-install-status-response.dto';
import { ReportNodeInstallProgressDto } from './dto/report-node-install-progress.dto';
import { EnrollmentEntity } from './entities/enrollment.entity';
import { EnrollmentStatus } from './entities/enrollment-status.enum';
import { NodeInstallEntity } from './entities/node-install.entity';
import { NodeInstallStatus } from './entities/node-install-status.enum';
import { EnrollmentTokensService } from './enrollment-tokens.service';

const ENROLLMENT_TOKEN_TTL_MINUTES = 15;
const NODE_INSTALL_TOKEN_TTL_MINUTES = 15;
const INITIAL_NODE_INSTALL_PROGRESS = 5;
const INITIAL_NODE_INSTALL_STAGE = 'command_generated';
const EXPIRED_NODE_INSTALL_STAGE = 'expired';
const BOOTSTRAP_CONSUMED_STAGE = 'bootstrap_token_consumed';
const TERMINAL_NODE_INSTALL_STATUSES = new Set<NodeInstallStatus>([
  NodeInstallStatus.COMPLETED,
  NodeInstallStatus.FAILED,
  NodeInstallStatus.EXPIRED,
]);

@Injectable()
export class EnrollmentsService {
  private readonly logger = new Logger(EnrollmentsService.name);

  constructor(
    @InjectRepository(EnrollmentEntity)
    private readonly enrollmentsRepository: Repository<EnrollmentEntity>,
    @InjectRepository(NodeInstallEntity)
    private readonly nodeInstallsRepository: Repository<NodeInstallEntity>,
    private readonly enrollmentTokensService: EnrollmentTokensService,
    private readonly usersService: UsersService,
    private readonly nodesService: NodesService,
    private readonly notificationsService: NotificationsService,
    private readonly workspacesService: WorkspacesService,
    private readonly configService: ConfigService,
    private readonly realtimeGateway: RealtimeGateway,
    private readonly redisService: RedisService,
    @Optional()
    private readonly outboxService?: OutboxService,
  ) {}

  async initiate(
    initiateEnrollmentDto: InitiateEnrollmentDto,
  ): Promise<InitiateEnrollmentResponseDto> {
    const email = this.normalizeEmail(initiateEnrollmentDto.email);
    const hostname = this.normalizeHostname(initiateEnrollmentDto.hostname);
    const { token, tokenHash, tokenLookupHash } =
      await this.enrollmentTokensService.issueEnrollmentToken();
    const expiresAt = new Date(
      Date.now() + ENROLLMENT_TOKEN_TTL_MINUTES * 60 * 1000,
    );

    const existingUser = await this.usersService.findByEmail(email);
    await this.revokePendingByEmailAndHostname(email, hostname);

    const enrollment = this.enrollmentsRepository.create({
      email,
      tokenHash,
      tokenLookupHash,
      hostname,
      additionalInfo: initiateEnrollmentDto.additionalInfo ?? null,
      expiresAt,
      status: EnrollmentStatus.PENDING,
      nodeId: null,
      agentToken: null,
    });

    await this.enrollmentsRepository.save(enrollment);

    await this.notificationsService.notifyEnrollmentInitiated({
      email,
      hostname,
      expiresAt,
      hasKnownUser: Boolean(existingUser),
    });

    if (existingUser) {
      this.logger.log(
        `Created pending enrollment for ${hostname} associated with ${email}`,
      );
    } else {
      this.logger.log(
        `Created pending enrollment for ${hostname} using unrecognized email ${email}`,
      );
    }

    return {
      token,
      expiresAt,
    };
  }

  async finalize(
    token: string,
    finalizeEnrollmentDto: FinalizeEnrollmentDto,
    workspaceId?: string,
  ): Promise<FinalizeEnrollmentResponseDto> {
    const enrollment = await this.findByTokenOrThrow(token, {
      includeAgentToken: true,
    });
    const email = this.normalizeEmail(finalizeEnrollmentDto.email);

    if (enrollment.email !== email) {
      throw new NotFoundException('Enrollment token was not found');
    }

    if (enrollment.status === EnrollmentStatus.APPROVED) {
      throw new ConflictException('Enrollment token has already been approved');
    }

    if (enrollment.status === EnrollmentStatus.REVOKED) {
      throw new GoneException('Enrollment token has expired or was revoked');
    }

    if (this.isExpired(enrollment)) {
      await this.revoke(enrollment);
      throw new GoneException('Enrollment token has expired or was revoked');
    }

    const resolvedWorkspaceId =
      workspaceId ??
      (await this.workspacesService.getDefaultWorkspaceOrFail()).id;
    await this.workspacesService.assertWorkspaceWritable(resolvedWorkspaceId);
    const agentToken = this.enrollmentTokensService.issueAgentToken();
    const node = await this.nodesService.createFromEnrollment({
      workspaceId: resolvedWorkspaceId,
      name: finalizeEnrollmentDto.nodeName,
      description: finalizeEnrollmentDto.description ?? null,
      hostname: enrollment.hostname,
      os: this.resolveNodeOs(enrollment.additionalInfo),
      arch: this.resolveNodeArch(enrollment.additionalInfo),
      agentTokenHash: this.nodesService.hashAgentToken(agentToken),
      agentVersion: this.readString(enrollment.additionalInfo, [
        'agentVersion',
      ]),
      platformVersion: this.readString(enrollment.additionalInfo, [
        'platformVersion',
      ]),
      kernelVersion: this.readString(enrollment.additionalInfo, [
        'kernelVersion',
      ]),
    });

    enrollment.status = EnrollmentStatus.APPROVED;
    enrollment.workspaceId = resolvedWorkspaceId;
    enrollment.nodeId = node.id;
    enrollment.agentToken = agentToken;
    enrollment.expiresAt = new Date();
    await this.enrollmentsRepository.save(enrollment);

    return {
      nodeId: node.id,
      agentToken,
    };
  }

  async getStatus(token: string): Promise<EnrollmentStatusResponseDto> {
    const enrollment = await this.findByTokenOrThrow(token, {
      includeAgentToken: true,
    });

    if (
      enrollment.status === EnrollmentStatus.PENDING &&
      this.isExpired(enrollment)
    ) {
      await this.revoke(enrollment);
      return {
        status: EnrollmentStatus.REVOKED,
      };
    }

    if (enrollment.status !== EnrollmentStatus.APPROVED) {
      return {
        status: enrollment.status,
      };
    }

    return {
      status: enrollment.status,
      nodeId: enrollment.nodeId ?? undefined,
      agentToken: enrollment.agentToken ?? undefined,
    };
  }

  async createNodeInstall(
    workspaceId: string,
    body: CreateNodeInstallDto,
    request?: Request,
  ): Promise<CreateNodeInstallResponseDto> {
    await this.workspacesService.assertWorkspaceWritable(workspaceId);
    const team = body.teamId
      ? await this.workspacesService.findTeamOrFail(workspaceId, body.teamId)
      : null;
    const { token, tokenHash, tokenLookupHash } =
      await this.enrollmentTokensService.issueEnrollmentToken();
    const expiresAt = new Date(
      Date.now() + NODE_INSTALL_TOKEN_TTL_MINUTES * 60 * 1000,
    );

    const nodeInstall = this.nodeInstallsRepository.create({
      workspaceId,
      teamId: team?.id ?? null,
      nodeName: body.nodeName.trim(),
      description: body.description?.trim() || null,
      tokenHash,
      tokenLookupHash,
      hostname: null,
      additionalInfo: null,
      nodeId: null,
      status: NodeInstallStatus.PENDING,
      stage: INITIAL_NODE_INSTALL_STAGE,
      progressPercent: INITIAL_NODE_INSTALL_PROGRESS,
      statusMessage: this.resolveDefaultNodeInstallMessage(
        INITIAL_NODE_INSTALL_STAGE,
        NodeInstallStatus.PENDING,
      ),
      startedAt: null,
      consumedAt: null,
      expiresAt,
    });

    const saved = await this.nodeInstallsRepository.save(nodeInstall);
    const agents =
      this.configService.getOrThrow<ConfigType<typeof agentsConfig>>(
        AGENTS_CONFIG_KEY,
      );
    const explicitPublicApiUrl = this.normalizePublicApiUrl(
      process.env.AGENT_PUBLIC_API_URL,
    );
    const publicApiUrl = this.resolveNodeInstallApiUrl(
      request,
      explicitPublicApiUrl,
      agents.publicApiUrl,
    );

    return {
      ...this.toNodeInstallStatusResponse(saved),
      installCommand: this.buildInstallCommand(
        agents.installScriptUrl,
        publicApiUrl,
        token,
      ),
      scriptUrl: agents.installScriptUrl,
      apiUrl: publicApiUrl,
    };
  }

  async getNodeInstallStatus(
    workspaceId: string,
    installId: string,
  ): Promise<NodeInstallStatusResponseDto> {
    await this.workspacesService.findWorkspaceOrFail(workspaceId);

    const nodeInstall = await this.nodeInstallsRepository.findOne({
      where: {
        id: installId,
        workspaceId,
      },
    });

    if (!nodeInstall) {
      throw new NotFoundException(`Node install ${installId} was not found`);
    }

    const normalized = await this.expireNodeInstallIfNeeded(nodeInstall);
    return this.toNodeInstallStatusResponse(normalized);
  }

  async reportNodeInstallProgress(
    body: ReportNodeInstallProgressDto,
  ): Promise<NodeInstallStatusResponseDto> {
    const nodeInstall = await this.findNodeInstallByTokenOrThrow(body.token);
    const normalized = await this.expireNodeInstallIfNeeded(nodeInstall);

    if (normalized.status === NodeInstallStatus.EXPIRED) {
      throw new GoneException('Bootstrap token has expired');
    }

    if (
      TERMINAL_NODE_INSTALL_STATUSES.has(normalized.status) &&
      normalized.status !== body.status
    ) {
      return this.toNodeInstallStatusResponse(normalized);
    }

    normalized.status = body.status ?? NodeInstallStatus.INSTALLING;
    normalized.stage = body.stage.trim();
    normalized.progressPercent =
      typeof body.progressPercent === 'number'
        ? body.progressPercent
        : normalized.progressPercent;
    normalized.statusMessage =
      body.statusMessage?.trim() ||
      this.resolveDefaultNodeInstallMessage(
        normalized.stage,
        normalized.status,
      );
    normalized.startedAt ??= new Date();

    const saved = await this.nodeInstallsRepository.save(normalized);
    await this.emitNodeInstallUpdated(saved);
    return this.toNodeInstallStatusResponse(saved);
  }

  async consumeNodeInstall(
    body: ConsumeNodeInstallDto,
  ): Promise<ConsumeNodeInstallResponseDto> {
    const nodeInstall = await this.findNodeInstallByTokenOrThrow(body.token);

    if (nodeInstall.consumedAt || nodeInstall.nodeId) {
      throw new ConflictException('Bootstrap token has already been used');
    }

    if (this.isNodeInstallExpired(nodeInstall)) {
      await this.expireNodeInstall(nodeInstall);
      throw new GoneException('Bootstrap token has expired');
    }

    await this.workspacesService.assertWorkspaceWritable(
      nodeInstall.workspaceId,
    );
    const hostname = this.normalizeHostname(body.hostname);
    const additionalInfo = body.additionalInfo
      ? { ...body.additionalInfo }
      : null;
    const agentToken = this.enrollmentTokensService.issueAgentToken();
    const node = await this.nodesService.createFromEnrollment({
      workspaceId: nodeInstall.workspaceId,
      teamId: nodeInstall.teamId,
      name: nodeInstall.nodeName,
      description: nodeInstall.description,
      hostname,
      os: this.resolveNodeOs(additionalInfo),
      arch: this.resolveNodeArch(additionalInfo),
      agentTokenHash: this.nodesService.hashAgentToken(agentToken),
      agentVersion: this.readString(additionalInfo, ['agentVersion']),
      platformVersion: this.readString(additionalInfo, ['platformVersion']),
      kernelVersion: this.readString(additionalInfo, ['kernelVersion']),
    });

    nodeInstall.hostname = hostname;
    nodeInstall.additionalInfo = additionalInfo;
    nodeInstall.nodeId = node.id;
    nodeInstall.consumedAt = new Date();
    nodeInstall.startedAt ??= nodeInstall.consumedAt;
    nodeInstall.status = NodeInstallStatus.INSTALLING;
    nodeInstall.stage = BOOTSTRAP_CONSUMED_STAGE;
    nodeInstall.progressPercent = Math.max(nodeInstall.progressPercent, 92);
    nodeInstall.statusMessage = this.resolveDefaultNodeInstallMessage(
      BOOTSTRAP_CONSUMED_STAGE,
      NodeInstallStatus.INSTALLING,
    );

    const saved = await this.nodeInstallsRepository.save(nodeInstall);
    await this.emitNodeInstallUpdated(saved);

    return {
      nodeId: node.id,
      agentToken,
    };
  }

  private async revokePendingByEmailAndHostname(
    email: string,
    hostname: string,
  ): Promise<void> {
    const existingEnrollments = await this.enrollmentsRepository.find({
      where: {
        email,
        hostname,
        status: EnrollmentStatus.PENDING,
      },
    });

    if (!existingEnrollments.length) {
      return;
    }

    const revokedAt = new Date();
    for (const enrollment of existingEnrollments) {
      enrollment.status = EnrollmentStatus.REVOKED;
      enrollment.expiresAt = revokedAt;
    }

    await this.enrollmentsRepository.save(existingEnrollments);
  }

  private async revoke(enrollment: EnrollmentEntity): Promise<void> {
    enrollment.status = EnrollmentStatus.REVOKED;
    enrollment.expiresAt = new Date();
    await this.enrollmentsRepository.save(enrollment);
  }

  private async findNodeInstallByTokenOrThrow(
    token: string,
  ): Promise<NodeInstallEntity> {
    const nodeInstall = await this.nodeInstallsRepository
      .createQueryBuilder('nodeInstall')
      .addSelect('nodeInstall.tokenHash')
      .addSelect('nodeInstall.tokenLookupHash')
      .where('nodeInstall.tokenLookupHash = :tokenLookupHash', {
        tokenLookupHash: this.enrollmentTokensService.createLookupHash(token),
      })
      .getOne();

    if (!nodeInstall) {
      throw new NotFoundException('Bootstrap token was not found');
    }

    const isValidToken = await this.enrollmentTokensService.verifyToken({
      token,
      tokenHash: nodeInstall.tokenHash,
      tokenLookupHash: nodeInstall.tokenLookupHash,
    });

    if (!isValidToken) {
      throw new NotFoundException('Bootstrap token was not found');
    }

    return nodeInstall;
  }

  private async findByTokenOrThrow(
    token: string,
    options?: { includeAgentToken?: boolean },
  ): Promise<EnrollmentEntity> {
    const query = this.enrollmentsRepository
      .createQueryBuilder('enrollment')
      .addSelect('enrollment.tokenHash')
      .addSelect('enrollment.tokenLookupHash')
      .where('enrollment.tokenLookupHash = :tokenLookupHash', {
        tokenLookupHash: this.enrollmentTokensService.createLookupHash(token),
      });

    if (options?.includeAgentToken) {
      query.addSelect('enrollment.agentToken');
    }

    const enrollment = await query.getOne();

    if (!enrollment) {
      throw new NotFoundException('Enrollment token was not found');
    }

    const isValidToken = await this.enrollmentTokensService.verifyToken({
      token,
      tokenHash: enrollment.tokenHash,
      tokenLookupHash: enrollment.tokenLookupHash,
    });

    if (!isValidToken) {
      throw new NotFoundException('Enrollment token was not found');
    }

    return enrollment;
  }

  private async emitNodeInstallUpdated(nodeInstall: NodeInstallEntity) {
    const payload = this.toNodeInstallStatusResponse(
      nodeInstall,
    ) as unknown as Record<string, unknown>;

    const redisPayload = {
      ...payload,
      sourceInstanceId: this.redisService.getInstanceId(),
    };

    if (this.outboxService) {
      await this.outboxService.enqueue({
        type: 'node-install.updated',
        payload: {
          nodeInstall: payload,
          redis: redisPayload,
        },
      });
      return;
    }

    this.realtimeGateway.emitNodeInstallUpdated(payload);
    await this.redisService.publish(
      PUBSUB_CHANNELS.NODE_INSTALLS_UPDATED,
      redisPayload,
    );
  }

  private async expireNodeInstallIfNeeded(
    nodeInstall: NodeInstallEntity,
  ): Promise<NodeInstallEntity> {
    if (
      nodeInstall.status === NodeInstallStatus.EXPIRED ||
      !this.isNodeInstallExpired(nodeInstall)
    ) {
      return nodeInstall;
    }

    return this.expireNodeInstall(nodeInstall);
  }

  private async expireNodeInstall(
    nodeInstall: NodeInstallEntity,
  ): Promise<NodeInstallEntity> {
    nodeInstall.status = NodeInstallStatus.EXPIRED;
    nodeInstall.stage = EXPIRED_NODE_INSTALL_STAGE;
    nodeInstall.statusMessage = this.resolveDefaultNodeInstallMessage(
      EXPIRED_NODE_INSTALL_STAGE,
      NodeInstallStatus.EXPIRED,
    );
    const saved = await this.nodeInstallsRepository.save(nodeInstall);
    await this.emitNodeInstallUpdated(saved);
    return saved;
  }

  private toNodeInstallStatusResponse(
    nodeInstall: NodeInstallEntity,
  ): NodeInstallStatusResponseDto {
    return {
      installId: nodeInstall.id,
      workspaceId: nodeInstall.workspaceId,
      teamId: nodeInstall.teamId,
      nodeName: nodeInstall.nodeName,
      description: nodeInstall.description,
      hostname: nodeInstall.hostname,
      nodeId: nodeInstall.nodeId,
      status: nodeInstall.status,
      stage: nodeInstall.stage,
      progressPercent: nodeInstall.progressPercent,
      statusMessage: nodeInstall.statusMessage,
      startedAt: nodeInstall.startedAt,
      consumedAt: nodeInstall.consumedAt,
      expiresAt: nodeInstall.expiresAt,
      createdAt: nodeInstall.createdAt,
      updatedAt: nodeInstall.updatedAt,
    };
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private normalizeHostname(hostname: string): string {
    return hostname.trim().toLowerCase();
  }

  private buildInstallCommand(
    scriptUrl: string,
    apiUrl: string,
    token: string,
  ): string {
    return [
      'curl -fsSL',
      this.shellEscape(scriptUrl),
      '| sudo bash -s --',
      '--api-url',
      this.shellEscape(apiUrl),
      '--bootstrap-token',
      this.shellEscape(token),
    ].join(' ');
  }

  private shellEscape(value: string): string {
    return `'${value.replace(/'/g, `'\"'\"'`)}'`;
  }

  private resolveNodeInstallApiUrl(
    request: Request | undefined,
    configuredUrl: string | null,
    fallback: string,
  ): string {
    const proxiedUrl = this.normalizePublicApiUrl(
      request
        ? this.readHeaderValue(request, 'x-noderax-public-api-url')
        : null,
    );
    const requestUrl = this.resolveRequestPublicApiUrl(request);
    const discoveredPublicUrl = proxiedUrl ?? requestUrl;

    if (configuredUrl && !this.isLoopbackPublicApiUrl(configuredUrl)) {
      return configuredUrl;
    }

    if (discoveredPublicUrl) {
      return discoveredPublicUrl;
    }

    if (configuredUrl) {
      return configuredUrl;
    }

    return this.normalizePublicApiUrl(fallback) ?? fallback;
  }

  private resolveRequestPublicApiUrl(request?: Request): string | null {
    if (!request) {
      return null;
    }

    const host =
      this.readHeaderValue(request, 'x-forwarded-host') ??
      this.readHeaderValue(request, 'host');
    if (!host) {
      return null;
    }

    const protocol =
      this.readHeaderValue(request, 'x-forwarded-proto')
        ?.split(',')[0]
        ?.trim() ||
      request.protocol ||
      'http';

    return this.normalizePublicApiUrl(`${protocol}://${host}`);
  }

  private readHeaderValue(request: Request, name: string): string | null {
    const value = request.headers[name];

    if (Array.isArray(value)) {
      return value.find((item) => item.trim().length > 0)?.trim() ?? null;
    }

    return typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : null;
  }

  private normalizePublicApiUrl(value?: string | null): string | null {
    const candidate = value?.trim();
    if (!candidate) {
      return null;
    }

    try {
      const url = new URL(candidate);
      url.hash = '';
      url.pathname = url.pathname.replace(/\/(?:api\/)?v1\/?$/i, '') || '/';
      return url.toString().replace(/\/$/, '');
    } catch {
      return null;
    }
  }

  private isLoopbackPublicApiUrl(value: string): boolean {
    try {
      const url = new URL(value);
      return ['localhost', '127.0.0.1', '::1'].includes(
        url.hostname.toLowerCase(),
      );
    } catch {
      return false;
    }
  }

  private isExpired(enrollment: Pick<EnrollmentEntity, 'expiresAt'>): boolean {
    return enrollment.expiresAt.getTime() <= Date.now();
  }

  private isNodeInstallExpired(
    nodeInstall: Pick<NodeInstallEntity, 'expiresAt' | 'consumedAt'>,
  ): boolean {
    return (
      !nodeInstall.consumedAt && nodeInstall.expiresAt.getTime() <= Date.now()
    );
  }

  private resolveNodeOs(
    additionalInfo: Record<string, unknown> | null,
  ): string {
    return (
      this.readString(additionalInfo, ['os', 'operatingSystem', 'platform']) ??
      'unknown'
    );
  }

  private resolveNodeArch(
    additionalInfo: Record<string, unknown> | null,
  ): string {
    return (
      this.readString(additionalInfo, ['arch', 'architecture']) ?? 'unknown'
    );
  }

  private readString(
    record: Record<string, unknown> | null,
    keys: string[],
  ): string | null {
    if (!record) {
      return null;
    }

    for (const key of keys) {
      const value = record[key];

      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
    }

    return null;
  }

  private resolveDefaultNodeInstallMessage(
    stage: string,
    status: NodeInstallStatus,
  ): string {
    if (status === NodeInstallStatus.FAILED) {
      return 'Installer reported a failure. Inspect the server output for details.';
    }

    if (status === NodeInstallStatus.EXPIRED) {
      return 'Bootstrap token expired before installation finished. Generate a fresh install command.';
    }

    switch (stage) {
      case INITIAL_NODE_INSTALL_STAGE:
        return 'Install command generated. Run it on the target server to start bootstrap.';
      case 'installer_started':
        return 'Installer started on the target server.';
      case 'dependencies_installing':
        return 'Installing required operating system packages.';
      case 'dependencies_ready':
        return 'Required operating system packages are ready.';
      case 'service_user_ready':
        return 'Preparing the noderax service account and runtime directories.';
      case 'binary_download_started':
        return 'Downloading the Noderax agent binary.';
      case 'binary_downloaded':
        return 'Agent binary downloaded. Bootstrapping node credentials next.';
      case 'agent_bootstrapping':
        return 'Bootstrapping node credentials and writing service config.';
      case BOOTSTRAP_CONSUMED_STAGE:
        return 'Node record created. Finishing service startup.';
      case 'service_started':
      case 'completed':
        return 'Agent installed successfully and the noderax service is running.';
      default:
        return status === NodeInstallStatus.COMPLETED
          ? 'Agent installation completed successfully.'
          : 'Installer progress updated.';
    }
  }
}
