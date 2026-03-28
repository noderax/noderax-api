import {
  ConflictException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NodesService } from '../nodes/nodes.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UsersService } from '../users/users.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { FinalizeEnrollmentDto } from './dto/finalize-enrollment.dto';
import { FinalizeEnrollmentResponseDto } from './dto/finalize-enrollment-response.dto';
import { EnrollmentStatusResponseDto } from './dto/enrollment-status-response.dto';
import { InitiateEnrollmentDto } from './dto/initiate-enrollment.dto';
import { InitiateEnrollmentResponseDto } from './dto/initiate-enrollment-response.dto';
import { EnrollmentEntity } from './entities/enrollment.entity';
import { EnrollmentStatus } from './entities/enrollment-status.enum';
import { EnrollmentTokensService } from './enrollment-tokens.service';

const ENROLLMENT_TOKEN_TTL_MINUTES = 15;

@Injectable()
export class EnrollmentsService {
  private readonly logger = new Logger(EnrollmentsService.name);

  constructor(
    @InjectRepository(EnrollmentEntity)
    private readonly enrollmentsRepository: Repository<EnrollmentEntity>,
    private readonly enrollmentTokensService: EnrollmentTokensService,
    private readonly usersService: UsersService,
    private readonly nodesService: NodesService,
    private readonly notificationsService: NotificationsService,
    private readonly workspacesService: WorkspacesService,
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
