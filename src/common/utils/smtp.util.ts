import { createTransport, type Transporter } from 'nodemailer';

export interface SmtpConnectionSettings {
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUsername: string;
  smtpPassword: string;
}

const SMTP_CONNECTION_TIMEOUT_MS = 5_000;
const SMTP_GREETING_TIMEOUT_MS = 5_000;
const SMTP_SOCKET_TIMEOUT_MS = 10_000;

export const createSmtpTransporter = (
  settings: SmtpConnectionSettings,
): Transporter =>
  createTransport({
    host: settings.smtpHost,
    port: settings.smtpPort,
    secure: settings.smtpSecure,
    auth: settings.smtpUsername.trim()
      ? {
          user: settings.smtpUsername,
          pass: settings.smtpPassword,
        }
      : undefined,
    connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS,
    greetingTimeout: SMTP_GREETING_TIMEOUT_MS,
    socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
  });

export const verifySmtpConnection = async (
  settings: SmtpConnectionSettings,
): Promise<void> => {
  if (!settings.smtpHost.trim()) {
    throw new Error('SMTP host is required to test email delivery.');
  }

  const transporter = createSmtpTransporter(settings);

  try {
    await transporter.verify();
  } finally {
    if (typeof transporter.close === 'function') {
      transporter.close();
    }
  }
};
