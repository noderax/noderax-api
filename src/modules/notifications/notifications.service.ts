import { Injectable, Logger } from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { MAIL_CONFIG_KEY, mailConfig } from '../../config';
import { EventEntity } from '../events/entities/event.entity';
import { UserEntity } from '../users/entities/user.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { WorkspaceMembershipRole } from '../workspaces/entities/workspace-membership-role.enum';
import { WorkspaceMembershipEntity } from '../workspaces/entities/workspace-membership.entity';
import { MailerService } from './mailer.service';

const WORKSPACE_ADMIN_ROLES = [
  WorkspaceMembershipRole.OWNER,
  WorkspaceMembershipRole.ADMIN,
];

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
    @InjectRepository(WorkspaceMembershipEntity)
    private readonly workspaceMembershipsRepository: Repository<WorkspaceMembershipEntity>,
    private readonly mailerService: MailerService,
    private readonly configService: ConfigService,
  ) {}

  async sendUserInvitation(input: {
    email: string;
    name: string;
    token: string;
    expiresAt: Date;
  }) {
    const inviteUrl = this.buildFrontendUrl(`/invite/${input.token}`);

    await this.mailerService.sendMail({
      to: [input.email],
      subject: 'You have been invited to Noderax',
      text: [
        `Hello ${input.name},`,
        '',
        'A platform admin invited you to Noderax.',
        `Set your password and activate your account here: ${inviteUrl}`,
        `This link expires at ${input.expiresAt.toISOString()}.`,
      ].join('\n'),
      html: [
        `<p>Hello ${this.escapeHtml(input.name)},</p>`,
        '<p>A platform admin invited you to Noderax.</p>',
        `<p><a href="${inviteUrl}">Set your password and activate your account</a></p>`,
        `<p>This link expires at ${this.escapeHtml(input.expiresAt.toISOString())}.</p>`,
      ].join(''),
    });
  }

  async sendPasswordReset(input: {
    email: string;
    name: string;
    token: string;
    expiresAt: Date;
  }) {
    const resetUrl = this.buildFrontendUrl(`/reset-password/${input.token}`);

    await this.mailerService.sendMail({
      to: [input.email],
      subject: 'Reset your Noderax password',
      text: [
        `Hello ${input.name},`,
        '',
        `Reset your password here: ${resetUrl}`,
        `This link expires at ${input.expiresAt.toISOString()}.`,
      ].join('\n'),
      html: [
        `<p>Hello ${this.escapeHtml(input.name)},</p>`,
        `<p><a href="${resetUrl}">Reset your password</a></p>`,
        `<p>This link expires at ${this.escapeHtml(input.expiresAt.toISOString())}.</p>`,
      ].join(''),
    });
  }

  async notifyEvent(event: EventEntity) {
    try {
      const recipients = await this.findCriticalEventRecipients(
        event.workspaceId,
      );

      if (!recipients.length) {
        return;
      }

      await this.mailerService.sendMail({
        to: recipients,
        subject: `[Noderax] Critical event: ${event.type}`,
        text: [
          `Critical event in workspace ${event.workspaceId}`,
          `Type: ${event.type}`,
          `Node: ${event.nodeId ?? 'n/a'}`,
          '',
          event.message,
        ].join('\n'),
      });
    } catch (error) {
      this.logger.error(
        'Failed to deliver critical event notification',
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      );
    }
  }

  async notifyEnrollmentInitiated(input: {
    email: string;
    hostname: string;
    expiresAt: Date;
    hasKnownUser: boolean;
  }) {
    try {
      const recipients = await this.findEnrollmentRecipients(input.email);

      if (!recipients.length) {
        return;
      }

      await this.mailerService.sendMail({
        to: recipients,
        subject: `[Noderax] Enrollment pending for ${input.hostname}`,
        text: [
          `Hostname: ${input.hostname}`,
          `Requested by: ${input.email}`,
          `Known operator: ${input.hasKnownUser ? 'yes' : 'no'}`,
          `Expires at: ${input.expiresAt.toISOString()}`,
        ].join('\n'),
      });
    } catch (error) {
      this.logger.error(
        'Failed to deliver enrollment notification',
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      );
    }
  }

  private async findCriticalEventRecipients(
    workspaceId: string,
  ): Promise<string[]> {
    const [platformAdmins, workspaceAdmins] = await Promise.all([
      this.usersRepository.find({
        where: {
          role: UserRole.PLATFORM_ADMIN,
          isActive: true,
          criticalEventEmailsEnabled: true,
        },
      }),
      this.findWorkspaceAdmins(workspaceId, 'criticalEventEmailsEnabled'),
    ]);

    return this.uniqueEmails([...platformAdmins, ...workspaceAdmins]);
  }

  private async findEnrollmentRecipients(email: string): Promise<string[]> {
    const platformAdmins = await this.usersRepository.find({
      where: {
        role: UserRole.PLATFORM_ADMIN,
        isActive: true,
        enrollmentEmailsEnabled: true,
      },
    });
    const knownUser = await this.usersRepository.findOne({
      where: { email: email.trim().toLowerCase() },
    });

    if (!knownUser) {
      return this.uniqueEmails(platformAdmins);
    }

    const memberships = await this.workspaceMembershipsRepository.find({
      where: { userId: knownUser.id },
      select: ['workspaceId'],
    });
    const workspaceIds = Array.from(
      new Set(memberships.map((membership) => membership.workspaceId)),
    );

    if (!workspaceIds.length) {
      return this.uniqueEmails(platformAdmins);
    }

    const workspaceAdmins = await this.findWorkspaceAdmins(
      workspaceIds,
      'enrollmentEmailsEnabled',
    );

    return this.uniqueEmails([...platformAdmins, ...workspaceAdmins]);
  }

  private async findWorkspaceAdmins(
    workspaceId: string | string[],
    preferenceKey: 'criticalEventEmailsEnabled' | 'enrollmentEmailsEnabled',
  ): Promise<UserEntity[]> {
    const workspaceIds = Array.isArray(workspaceId)
      ? workspaceId
      : [workspaceId];
    const memberships = await this.workspaceMembershipsRepository.find({
      where: {
        workspaceId: In(workspaceIds),
        role: In(WORKSPACE_ADMIN_ROLES),
      },
      select: ['userId'],
    });

    const userIds = Array.from(
      new Set(memberships.map((membership) => membership.userId)),
    );

    if (!userIds.length) {
      return [];
    }

    return this.usersRepository.find({
      where: {
        id: In(userIds),
        isActive: true,
        [preferenceKey]: true,
      },
    });
  }

  private uniqueEmails(users: Pick<UserEntity, 'email'>[]): string[] {
    return Array.from(
      new Set(
        users.map((user) => user.email.trim().toLowerCase()).filter(Boolean),
      ),
    );
  }

  private buildFrontendUrl(path: string): string {
    const settings =
      this.configService.getOrThrow<ConfigType<typeof mailConfig>>(
        MAIL_CONFIG_KEY,
      );
    return `${settings.webAppUrl.replace(/\/$/, '')}${path}`;
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
