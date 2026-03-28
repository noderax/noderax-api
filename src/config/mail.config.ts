import { registerAs } from '@nestjs/config';

export const MAIL_CONFIG_KEY = 'mail';

export const mailConfig = registerAs(MAIL_CONFIG_KEY, () => ({
  smtpHost: process.env.SMTP_HOST ?? '',
  smtpPort: parseInt(process.env.SMTP_PORT ?? '587', 10),
  smtpSecure: process.env.SMTP_SECURE === 'true',
  smtpUsername: process.env.SMTP_USERNAME ?? '',
  smtpPassword: process.env.SMTP_PASSWORD ?? '',
  fromEmail: process.env.SMTP_FROM_EMAIL ?? 'noreply@noderax.local',
  fromName: process.env.SMTP_FROM_NAME ?? 'Noderax',
  jsonTransport:
    process.env.NODE_ENV === 'test' ||
    process.env.SMTP_JSON_TRANSPORT === 'true',
  webAppUrl: process.env.WEB_APP_URL ?? 'http://localhost:3001',
}));
