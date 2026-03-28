import { MailSettingsDto } from '../../common/dto/mail-settings.dto';
import { verifySmtpConnection } from '../../common/utils/smtp.util';
import { SetupService } from './setup.service';

jest.mock('../../common/utils/smtp.util', () => ({
  verifySmtpConnection: jest.fn(),
}));

describe('SetupService', () => {
  let service: SetupService;

  beforeEach(() => {
    service = new SetupService();
    delete process.env.NODERAX_BOOT_MODE;
    jest.clearAllMocks();
  });

  it('includes mail env keys when runtime env is built', () => {
    const runtimeEnv = (service as any).buildRuntimeEnv({
      postgres: {
        host: '127.0.0.1',
        port: 5432,
        username: 'postgres',
        password: 'postgres',
        database: 'noderax',
        ssl: false,
      },
      redis: {
        host: '127.0.0.1',
        port: 6379,
        password: '',
        db: 0,
      },
      admin: {
        name: 'Admin',
        email: 'admin@example.com',
        password: 'ChangeMe123!',
      },
      workspace: {
        name: 'Workspace',
        slug: 'workspace',
        defaultTimezone: 'UTC',
      },
      mail: {
        smtpHost: 'smtp.resend.com',
        smtpPort: 587,
        smtpSecure: false,
        smtpUsername: 'resend',
        smtpPassword: 'secret',
        fromEmail: 'info@noderax.net',
        fromName: 'Noderax Support',
        webAppUrl: 'https://app.noderax.net',
      },
    });

    expect(runtimeEnv).toMatchObject({
      SMTP_HOST: 'smtp.resend.com',
      SMTP_PORT: '587',
      SMTP_SECURE: 'false',
      SMTP_USERNAME: 'resend',
      SMTP_PASSWORD: 'secret',
      SMTP_FROM_EMAIL: 'info@noderax.net',
      SMTP_FROM_NAME: 'Noderax Support',
      WEB_APP_URL: 'https://app.noderax.net',
    });
    expect(runtimeEnv.JWT_SECRET).toEqual(expect.any(String));
    expect(runtimeEnv.AGENT_ENROLLMENT_TOKEN).toEqual(expect.any(String));
  });

  it('preserves blank-host mail mode in runtime env', () => {
    const runtimeEnv = (service as any).buildRuntimeEnv({
      postgres: {
        host: '127.0.0.1',
        port: 5432,
        username: 'postgres',
        password: 'postgres',
        database: 'noderax',
        ssl: false,
      },
      redis: {
        host: '127.0.0.1',
        port: 6379,
        password: '',
        db: 0,
      },
      admin: {
        name: 'Admin',
        email: 'admin@example.com',
        password: 'ChangeMe123!',
      },
      workspace: {
        name: 'Workspace',
        slug: 'workspace',
        defaultTimezone: 'UTC',
      },
      mail: {
        smtpHost: '',
        smtpPort: 587,
        smtpSecure: false,
        smtpUsername: '',
        smtpPassword: '',
        fromEmail: 'noreply@noderax.local',
        fromName: 'Noderax',
        webAppUrl: 'http://localhost:3001',
      },
    });

    expect(runtimeEnv).toMatchObject({
      SMTP_HOST: '',
      SMTP_PORT: '587',
      SMTP_SECURE: 'false',
      SMTP_USERNAME: '',
      SMTP_PASSWORD: '',
      SMTP_FROM_EMAIL: 'noreply@noderax.local',
      SMTP_FROM_NAME: 'Noderax',
      WEB_APP_URL: 'http://localhost:3001',
    });
    expect(runtimeEnv.JWT_SECRET).toEqual(expect.any(String));
    expect(runtimeEnv.AGENT_ENROLLMENT_TOKEN).toEqual(expect.any(String));
  });

  it('returns success when SMTP validation succeeds', async () => {
    (verifySmtpConnection as jest.Mock).mockResolvedValue(undefined);

    await expect(service.validateSmtp(buildMailDto())).resolves.toEqual({
      success: true,
    });

    expect(verifySmtpConnection).toHaveBeenCalledWith({
      smtpHost: 'smtp.resend.com',
      smtpPort: 587,
      smtpSecure: false,
      smtpUsername: 'resend',
      smtpPassword: 'secret',
    });
  });

  it('wraps SMTP validation failures in a bad request exception', async () => {
    (verifySmtpConnection as jest.Mock).mockRejectedValue(
      new Error('connect timeout'),
    );

    await expect(service.validateSmtp(buildMailDto())).rejects.toThrow(
      'SMTP validation failed: connect timeout',
    );
  });
});

const buildMailDto = (): MailSettingsDto => ({
  smtpHost: 'smtp.resend.com',
  smtpPort: 587,
  smtpSecure: false,
  smtpUsername: 'resend',
  smtpPassword: 'secret',
  fromEmail: 'info@noderax.net',
  fromName: 'Noderax Support',
  webAppUrl: 'https://app.noderax.net',
});
