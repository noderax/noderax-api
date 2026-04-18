import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import {
  createTransport,
  type SentMessageInfo,
  type Transporter,
} from 'nodemailer';
import { MAIL_CONFIG_KEY, mailConfig } from '../../config';
import { createSmtpTransporter } from '../../common/utils/smtp.util';

export interface MailDeliveryRecord {
  to: string[];
  subject: string;
  text: string;
  html?: string;
  attachments?: MailInlineAttachment[];
}

export interface MailInlineAttachment {
  filename: string;
  content: string | Buffer;
  contentType?: string;
  encoding?: string;
  cid: string;
  disposition?: 'inline' | 'attachment';
}

@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private transporter: Transporter | null = null;
  private transporterKey: string | null = null;
  private readonly deliveries: MailDeliveryRecord[] = [];

  constructor(private readonly configService: ConfigService) {}

  isConfigured(): boolean {
    const config = this.getSettings();
    return config.jsonTransport || Boolean(config.smtpHost.trim());
  }

  getDeliveries(): MailDeliveryRecord[] {
    return [...this.deliveries];
  }

  clearDeliveries(): void {
    this.deliveries.length = 0;
  }

  async sendMail(input: MailDeliveryRecord): Promise<SentMessageInfo> {
    const settings = this.getSettings();

    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        'Email delivery is not configured for this environment.',
      );
    }

    const transporter = this.getTransporter(settings);

    try {
      const info = await transporter.sendMail({
        from: `${settings.fromName} <${settings.fromEmail}>`,
        to: input.to.join(', '),
        subject: input.subject,
        text: input.text,
        html: input.html,
        attachments: input.attachments,
      });

      this.deliveries.push(input);
      this.logger.log(
        `Delivered email "${input.subject}" to ${input.to.join(', ')}`,
      );

      return info;
    } catch (error) {
      const smtpError = error as Error & {
        code?: string;
        responseCode?: number;
        command?: string;
      };

      this.logger.error(
        `Email delivery failed via ${settings.smtpHost}:${settings.smtpPort} (${smtpError.code ?? 'unknown'})${
          smtpError.responseCode ? ` response=${smtpError.responseCode}` : ''
        }${smtpError.command ? ` command=${smtpError.command}` : ''}`,
        smtpError.stack ?? smtpError.message,
      );

      throw new ServiceUnavailableException(
        'Email delivery failed. Check SMTP credentials or SMTP connectivity.',
      );
    }
  }

  private getTransporter(settings: ConfigType<typeof mailConfig>): Transporter {
    const nextTransporterKey = JSON.stringify({
      jsonTransport: settings.jsonTransport,
      smtpHost: settings.smtpHost,
      smtpPort: settings.smtpPort,
      smtpSecure: settings.smtpSecure,
      smtpUsername: settings.smtpUsername,
      smtpPassword: settings.smtpPassword,
    });

    if (this.transporter && this.transporterKey === nextTransporterKey) {
      return this.transporter;
    }

    const activeTransporter = this.transporter as
      | (Transporter & { close?: () => void })
      | null;
    activeTransporter?.close?.();

    this.transporter = settings.jsonTransport
      ? createTransport({
          jsonTransport: true,
        })
      : createSmtpTransporter({
          smtpHost: settings.smtpHost,
          smtpPort: settings.smtpPort,
          smtpSecure: settings.smtpSecure,
          smtpUsername: settings.smtpUsername,
          smtpPassword: settings.smtpPassword,
        });
    this.transporterKey = nextTransporterKey;

    return this.transporter;
  }

  private getSettings() {
    return this.configService.getOrThrow<ConfigType<typeof mailConfig>>(
      MAIL_CONFIG_KEY,
    );
  }
}
