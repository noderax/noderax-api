import {
  ConflictException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AGENTS_CONFIG_KEY, agentsConfig } from '../../config';
import { NodesService } from '../nodes/nodes.service';
import { NotificationsService } from '../notifications/notifications.service';
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
import { EnrollmentEntity } from './entities/enrollment.entity';
import { EnrollmentStatus } from './entities/enrollment-status.enum';
import { NodeInstallEntity } from './entities/node-install.entity';
import { EnrollmentTokensService } from './enrollment-tokens.service';

const ENROLLMENT_TOKEN_TTL_MINUTES = 15;
const NODE_INSTALL_TOKEN_TTL_MINUTES = 15;

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

    void this.notificationsService.notifyEnrollmentInitiated({
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
      consumedAt: null,
      expiresAt,
    });

    const saved = await this.nodeInstallsRepository.save(nodeInstall);
    const agents =
      this.configService.getOrThrow<ConfigType<typeof agentsConfig>>(
        AGENTS_CONFIG_KEY,
      );

    return {
      installId: saved.id,
      installCommand: this.buildInstallCommand(
        agents.installScriptUrl,
        agents.publicApiUrl,
        token,
      ),
      scriptUrl: agents.installScriptUrl,
      apiUrl: agents.publicApiUrl,
      expiresAt,
    };
  }

  async consumeNodeInstall(
    body: ConsumeNodeInstallDto,
  ): Promise<ConsumeNodeInstallResponseDto> {
    const nodeInstall = await this.findNodeInstallByTokenOrThrow(body.token);

    if (nodeInstall.consumedAt || nodeInstall.nodeId) {
      throw new ConflictException('Bootstrap token has already been used');
    }

    if (this.isExpired(nodeInstall)) {
      throw new GoneException('Bootstrap token has expired');
    }

    await this.workspacesService.assertWorkspaceWritable(nodeInstall.workspaceId);
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
    nodeInstall.expiresAt = nodeInstall.consumedAt;
    await this.nodeInstallsRepository.save(nodeInstall);

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

  private isExpired(enrollment: Pick<EnrollmentEntity, 'expiresAt'>): boolean {
    return enrollment.expiresAt.getTime() <= Date.now();
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
}
