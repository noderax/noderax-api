import { Injectable, Logger } from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { MAIL_CONFIG_KEY, mailConfig } from '../../config';
import { EventEntity } from '../events/entities/event.entity';
import { EventSeverity } from '../events/entities/event-severity.enum';
import { UserEntity } from '../users/entities/user.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { WorkspaceMembershipRole } from '../workspaces/entities/workspace-membership-role.enum';
import { WorkspaceMembershipEntity } from '../workspaces/entities/workspace-membership.entity';
import { WorkspaceEntity } from '../workspaces/entities/workspace.entity';
import { NodeEntity } from '../nodes/entities/node.entity';
import { MailerService } from './mailer.service';

const WORKSPACE_ADMIN_ROLES = [
  WorkspaceMembershipRole.OWNER,
  WorkspaceMembershipRole.ADMIN,
];

type EmailTone = 'default' | 'warning' | 'critical';

type EmailDetail = {
  label: string;
  value: string;
};

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
    @InjectRepository(WorkspaceMembershipEntity)
    private readonly workspaceMembershipsRepository: Repository<WorkspaceMembershipEntity>,
    @InjectRepository(WorkspaceEntity)
    private readonly workspacesRepository: Repository<WorkspaceEntity>,
    @InjectRepository(NodeEntity)
    private readonly nodesRepository: Repository<NodeEntity>,
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
    const email = this.buildStyledEmail({
      eyebrow: 'Access invitation',
      title: 'You have been invited to Noderax',
      greeting: `Hello ${input.name},`,
      paragraphs: [
        'A platform admin invited you to the Noderax control plane.',
        'Activate your account and set your password to start managing workspaces, nodes, and tasks.',
      ],
      ctaLabel: 'Activate account',
      ctaUrl: inviteUrl,
      details: [
        { label: 'Account email', value: input.email },
        {
          label: 'Invite expires',
          value: this.formatTimestamp(input.expiresAt),
        },
      ],
      footnote:
        'If you were not expecting this invitation, you can safely ignore this email.',
    });

    await this.mailerService.sendMail({
      to: [input.email],
      subject: 'You have been invited to Noderax',
      text: email.text,
      html: email.html,
    });
  }

  async sendPasswordReset(input: {
    email: string;
    name: string;
    token: string;
    expiresAt: Date;
  }) {
    const resetUrl = this.buildFrontendUrl(`/reset-password/${input.token}`);
    const email = this.buildStyledEmail({
      eyebrow: 'Security',
      title: 'Reset your Noderax password',
      greeting: `Hello ${input.name},`,
      paragraphs: [
        'We received a request to reset your Noderax password.',
        'Use the secure link below to choose a new password and regain access.',
      ],
      ctaLabel: 'Reset password',
      ctaUrl: resetUrl,
      details: [
        { label: 'Account email', value: input.email },
        {
          label: 'Reset link expires',
          value: this.formatTimestamp(input.expiresAt),
        },
      ],
      footnote:
        'If you did not request this reset, you can ignore this email and your password will stay the same.',
    });

    await this.mailerService.sendMail({
      to: [input.email],
      subject: 'Reset your Noderax password',
      text: email.text,
      html: email.html,
    });
  }

  async notifyEvent(event: EventEntity) {
    try {
      const workspace = await this.workspacesRepository.findOne({
        where: { id: event.workspaceId },
      });

      if (!workspace) {
        this.logger.warn(
          `Could not find workspace ${event.workspaceId} for event notification`,
        );
        return;
      }

      const node = event.nodeId
        ? await this.nodesRepository.findOne({ where: { id: event.nodeId } })
        : null;
      const isNodeScoped = Boolean(event.nodeId);
      const nodeEmailEnabled =
        !isNodeScoped ||
        !node ||
        (node.notificationEmailEnabled !== false &&
          this.nodeAllowsSeverity(
            node.notificationEmailLevels,
            event.severity,
          ));
      const nodeTelegramEnabled =
        !isNodeScoped ||
        !node ||
        (node.notificationTelegramEnabled !== false &&
          this.nodeAllowsSeverity(
            node.notificationTelegramLevels,
            event.severity,
          ));

      // 1. Telegram Automation
      if (
        workspace.automationTelegramEnabled &&
        workspace.automationTelegramBotToken &&
        workspace.automationTelegramChatId &&
        workspace.automationTelegramLevels.includes(event.severity) &&
        nodeTelegramEnabled
      ) {
        await this.sendTelegramMessage(workspace, event, node);
      }

      // 2. Email Automation
      const shouldSendEmail = isNodeScoped
        ? workspace.automationEmailEnabled &&
          workspace.automationEmailLevels.includes(event.severity) &&
          nodeEmailEnabled
        : event.severity === EventSeverity.CRITICAL ||
          (workspace.automationEmailEnabled &&
            workspace.automationEmailLevels.includes(event.severity));

      if (shouldSendEmail) {
        const [
          platformAdmins,
          workspaceAdminsWithPreference,
          allWorkspaceAdmins,
        ] = await Promise.all([
          this.usersRepository.find({
            where: {
              role: UserRole.PLATFORM_ADMIN,
              isActive: true,
              criticalEventEmailsEnabled: true,
            },
          }),
          this.findWorkspaceAdmins(
            event.workspaceId,
            'criticalEventEmailsEnabled',
          ),
          this.findWorkspaceAdmins(event.workspaceId),
        ]);

        const recipientEmails: string[] = [];

        if (event.severity === EventSeverity.CRITICAL) {
          recipientEmails.push(
            ...this.uniqueEmails([
              ...platformAdmins,
              ...workspaceAdminsWithPreference,
            ]),
          );
        }

        if (workspace.automationEmailEnabled) {
          recipientEmails.push(...this.uniqueEmails(allWorkspaceAdmins));
        }

        const uniqueRecipientsList = Array.from(new Set(recipientEmails));

        if (uniqueRecipientsList.length > 0) {
          const nodeDisplay = node
            ? `${node.name} (${node.id})`
            : (event.nodeId ?? 'n/a');
          const email = this.buildStyledEmail({
            eyebrow: 'Event notification',
            title: `Event detected: ${event.type}`,
            paragraphs: [
              `Noderax recorded an event in workspace "${workspace.name}" that may need attention.`,
              event.message,
            ],
            ctaLabel: 'Open Noderax',
            ctaUrl: this.buildFrontendUrl(''),
            tone: this.resolveTone(event.severity),
            details: [
              { label: 'Severity', value: event.severity.toUpperCase() },
              { label: 'Workspace', value: workspace.name },
              { label: 'Node', value: nodeDisplay },
              {
                label: 'Detected at',
                value: this.formatTimestamp(event.createdAt),
              },
            ],
          });

          await this.mailerService.sendMail({
            to: uniqueRecipientsList,
            subject: `[Noderax] ${event.severity.toUpperCase()} event: ${event.type}`,
            text: email.text,
            html: email.html,
          });
        }
      }
    } catch (error) {
      this.logger.error(
        'Failed to deliver event notification',
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      );
    }
  }

  private async sendTelegramMessage(
    workspace: WorkspaceEntity,
    event: EventEntity,
    node?: NodeEntity | null,
  ) {
    try {
      const severityEmoji =
        event.severity === EventSeverity.CRITICAL
          ? '🔴'
          : event.severity === EventSeverity.WARNING
            ? '🟠'
            : '🔵';

      const dashboardUrl = this.buildFrontendUrl('');
      const nodeDisplay = node
        ? `${node.name} (${node.id})`
        : (event.nodeId ?? 'n/a');
      const text =
        `<b>${severityEmoji} Noderax Event</b>\n\n` +
        `<b>Type:</b> ${this.escapeTelegramHtml(event.type)}\n` +
        `<b>Workspace:</b> ${this.escapeTelegramHtml(workspace.name)}\n` +
        `<b>Severity:</b> ${this.escapeTelegramHtml(event.severity.toUpperCase())}\n` +
        `<b>Node:</b> ${this.escapeTelegramHtml(nodeDisplay)}\n\n` +
        `<code>${this.escapeTelegramHtml(event.message)}</code>\n\n` +
        `<a href="${this.escapeTelegramHtml(dashboardUrl)}">Open Dashboard</a>`;

      const response = await fetch(
        `https://api.telegram.org/bot${workspace.automationTelegramBotToken}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: workspace.automationTelegramChatId,
            text,
            parse_mode: 'HTML',
          }),
        },
      );

      if (!response.ok) {
        const body = await response.text();
        this.logger.error(
          `Telegram API error for workspace ${workspace.id}: ${response.status} ${body}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to send Telegram message for workspace ${workspace.id}`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private escapeTelegramHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  private escapeMarkdown(value: string): string {
    // Basic Markdown V1 escaping
    return value.replace(/([_*`\[])/g, '\\$1');
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

      const email = this.buildStyledEmail({
        eyebrow: 'Enrollment request',
        title: `Enrollment pending for ${input.hostname}`,
        paragraphs: [
          'A node enrollment request is waiting for review in Noderax.',
          'Use the dashboard to confirm the request and complete the approval flow.',
        ],
        ctaLabel: 'Open Noderax',
        ctaUrl: this.buildFrontendUrl(''),
        tone: 'warning',
        details: [
          { label: 'Hostname', value: input.hostname },
          { label: 'Requested by', value: input.email },
          {
            label: 'Known operator',
            value: input.hasKnownUser ? 'Yes' : 'No',
          },
          {
            label: 'Request expires',
            value: this.formatTimestamp(input.expiresAt),
          },
        ],
      });

      await this.mailerService.sendMail({
        to: recipients,
        subject: `[Noderax] Enrollment pending for ${input.hostname}`,
        text: email.text,
        html: email.html,
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
    preferenceKey?: 'criticalEventEmailsEnabled' | 'enrollmentEmailsEnabled',
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
        ...(preferenceKey ? { [preferenceKey]: true } : {}),
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

  private buildStyledEmail(input: {
    eyebrow: string;
    title: string;
    paragraphs: string[];
    greeting?: string;
    ctaLabel?: string;
    ctaUrl?: string;
    details?: EmailDetail[];
    footnote?: string;
    tone?: EmailTone;
  }): { text: string; html: string } {
    const palette = this.getEmailPalette(input.tone ?? 'default');
    const appUrl = this.buildFrontendUrl('');
    const logoUrl = this.buildFrontendUrl('/logo-white.png');
    const details = input.details ?? [];
    const textSections = [
      'Noderax',
      input.title,
      '',
      input.greeting ?? '',
      input.greeting ? '' : '',
      ...input.paragraphs.flatMap((paragraph) => [paragraph, '']),
      input.ctaLabel && input.ctaUrl
        ? `${input.ctaLabel}: ${input.ctaUrl}`
        : '',
      input.ctaLabel && input.ctaUrl ? '' : '',
      ...details.flatMap((detail) => [`${detail.label}: ${detail.value}`, '']),
      input.footnote ?? '',
      input.footnote ? '' : '',
      `Open Noderax: ${appUrl}`,
    ]
      .filter((line, index, lines) => {
        if (line) {
          return true;
        }

        const previous = lines[index - 1];
        return Boolean(previous);
      })
      .join('\n');

    const paragraphsHtml = input.paragraphs
      .map(
        (paragraph) =>
          `<p style="margin:0 0 14px;color:${palette.body};font-size:16px;line-height:1.7;">${this.escapeHtml(paragraph)}</p>`,
      )
      .join('');

    const detailsHtml = details.length
      ? `
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:24px 0 0;border-collapse:separate;border-spacing:0;background:${palette.surface};border:1px solid ${palette.border};border-radius:18px;">
          ${details
            .map(
              (detail, index) => `
                <tr>
                  <td style="padding:14px 18px;${index < details.length - 1 ? `border-bottom:1px solid ${palette.border};` : ''}">
                    <div style="margin:0 0 4px;color:${palette.muted};font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">
                      ${this.escapeHtml(detail.label)}
                    </div>
                    <div style="margin:0;color:${palette.title};font-size:15px;line-height:1.6;font-weight:600;">
                      ${this.escapeHtmlWithBreaks(detail.value)}
                    </div>
                  </td>
                </tr>
              `,
            )
            .join('')}
        </table>
      `
      : '';

    const ctaHtml =
      input.ctaLabel && input.ctaUrl
        ? `
          <table role="presentation" cellspacing="0" cellpadding="0" style="margin:26px 0 0;">
            <tr>
              <td align="center" bgcolor="${palette.button}" style="border-radius:14px;">
                <a
                  href="${this.escapeHtml(input.ctaUrl)}"
                  style="display:inline-block;padding:14px 22px;color:#ffffff;font-size:15px;font-weight:700;line-height:1;text-decoration:none;"
                >
                  ${this.escapeHtml(input.ctaLabel)}
                </a>
              </td>
            </tr>
          </table>
          <p style="margin:14px 0 0;color:${palette.muted};font-size:13px;line-height:1.6;">
            Button not working? Copy and paste this link into your browser:<br />
            <a href="${this.escapeHtml(input.ctaUrl)}" style="color:${palette.accent};text-decoration:none;">${this.escapeHtml(input.ctaUrl)}</a>
          </p>
        `
        : '';

    const greetingHtml = input.greeting
      ? `<p style="margin:0 0 14px;color:${palette.title};font-size:16px;line-height:1.7;font-weight:600;">${this.escapeHtml(input.greeting)}</p>`
      : '';

    const footnoteHtml = input.footnote
      ? `<p style="margin:24px 0 0;color:${palette.muted};font-size:13px;line-height:1.7;">${this.escapeHtml(input.footnote)}</p>`
      : '';

    return {
      text: textSections,
      html: `
        <!DOCTYPE html>
        <html lang="en">
          <body style="margin:0;padding:24px;background:#f6f2ed;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
            <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
              ${this.escapeHtml(input.title)}
            </div>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
              <tr>
                <td align="center">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;border-collapse:collapse;">
                    <tr>
                      <td style="padding:0 0 16px;">
                        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                          <tr>
                            <td valign="middle">
                              <span style="display:inline-block;padding:8px;border-radius:16px;background:${palette.button};vertical-align:middle;">
                                <img
                                  src="${this.escapeHtml(logoUrl)}"
                                  alt="Noderax"
                                  width="40"
                                  height="40"
                                  style="display:block;width:40px;height:40px;border:0;outline:none;text-decoration:none;"
                                />
                              </span>
                              <span style="display:inline-block;margin-left:12px;color:#171717;font-size:18px;font-weight:800;letter-spacing:0.01em;vertical-align:middle;">Noderax</span>
                            </td>
                            <td align="right" valign="middle">
                              <span style="display:inline-block;padding:8px 12px;border-radius:999px;background:${palette.badgeBg};color:${palette.badgeText};font-size:11px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;">
                                ${this.escapeHtml(input.eyebrow)}
                              </span>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                    <tr>
                      <td style="background:#ffffff;border:1px solid #eadfd7;border-radius:26px;padding:36px 34px 30px;box-shadow:0 14px 34px rgba(23,19,15,0.08);">
                        <div style="margin:0 0 16px;">
                          <span style="display:inline-block;padding:7px 11px;border-radius:999px;background:${palette.badgeBg};color:${palette.badgeText};font-size:11px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;">
                            Noderax control plane
                          </span>
                        </div>
                        <h1 style="margin:0 0 14px;color:${palette.title};font-size:30px;line-height:1.2;font-weight:800;letter-spacing:-0.03em;">
                          ${this.escapeHtml(input.title)}
                        </h1>
                        ${greetingHtml}
                        ${paragraphsHtml}
                        ${ctaHtml}
                        ${detailsHtml}
                        ${footnoteHtml}
                      </td>
                    </tr>
                    <tr>
                      <td style="padding:16px 8px 0;color:#756b65;font-size:12px;line-height:1.7;text-align:center;">
                        Sent by Noderax. Open your dashboard at
                        <a href="${this.escapeHtml(appUrl)}" style="color:${palette.accent};text-decoration:none;">${this.escapeHtml(appUrl)}</a>.
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </body>
        </html>
      `,
    };
  }

  private getEmailPalette(tone: EmailTone) {
    switch (tone) {
      case 'critical':
        return {
          accent: '#c2410c',
          badgeBg: '#fff1eb',
          badgeText: '#b93815',
          button: '#7f1d1d',
          surface: '#fff5f3',
          border: '#f2d6cf',
          title: '#211310',
          body: '#4e3c37',
          muted: '#7d6861',
        };
      case 'warning':
        return {
          accent: '#b45309',
          badgeBg: '#fff7e8',
          badgeText: '#a16207',
          button: '#171717',
          surface: '#fffbf2',
          border: '#f0e1bf',
          title: '#211910',
          body: '#52463a',
          muted: '#7c6f63',
        };
      default:
        return {
          accent: '#d65c36',
          badgeBg: '#fff1eb',
          badgeText: '#c24d29',
          button: '#171717',
          surface: '#faf6f1',
          border: '#eadfd7',
          title: '#1d1612',
          body: '#4d433d',
          muted: '#7b7069',
        };
    }
  }

  private resolveTone(severity: EventSeverity): EmailTone {
    switch (severity) {
      case EventSeverity.CRITICAL:
        return 'critical';
      case EventSeverity.WARNING:
        return 'warning';
      default:
        return 'default';
    }
  }

  private formatTimestamp(value: Date): string {
    return value.toUTCString();
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

  private escapeHtmlWithBreaks(value: string): string {
    return this.escapeHtml(value).replace(/\n/g, '<br />');
  }

  private nodeAllowsSeverity(
    levels: EventSeverity[] | string[] | null | undefined,
    severity: EventSeverity,
  ) {
    if (!levels || levels.length === 0) {
      return false;
    }

    return levels.includes(severity);
  }
}
