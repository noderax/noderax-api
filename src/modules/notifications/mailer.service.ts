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

export interface MailDeliveryRecord {
  to: string[];
  subject: string;
  text: string;
  html?: string;
}

@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private transporter: Transporter | null = null;
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
    const info = await transporter.sendMail({
      from: `${settings.fromName} <${settings.fromEmail}>`,
      to: input.to.join(', '),
      subject: input.subject,
      text: input.text,
      html: input.html,
    });

    this.deliveries.push(input);
    this.logger.log(
      `Delivered email "${input.subject}" to ${input.to.join(', ')}`,
    );

    return info;
  }

  private getTransporter(settings: ConfigType<typeof mailConfig>): Transporter {
    if (this.transporter) {
      return this.transporter;
    }

    this.transporter = settings.jsonTransport
      ? createTransport({
          jsonTransport: true,
        })
      : createTransport({
          host: settings.smtpHost,
          port: settings.smtpPort,
          secure: settings.smtpSecure,
          auth: settings.smtpUsername.trim()
            ? {
                user: settings.smtpUsername,
                pass: settings.smtpPassword,
              }
            : undefined,
        });

    return this.transporter;
  }

  private getSettings() {
    return this.configService.getOrThrow<ConfigType<typeof mailConfig>>(
      MAIL_CONFIG_KEY,
    );
  }
}
