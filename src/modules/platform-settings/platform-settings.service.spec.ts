import { MailSettingsDto } from '../../common/dto/mail-settings.dto';
import { verifySmtpConnection } from '../../common/utils/smtp.util';
import { INSTALLER_MANAGED_FLAG } from '../../install/install-state';
import { PlatformSettingsService } from './platform-settings.service';

let installStateValue: {
  version: number;
  source: 'installer';
  installedAt: string;
  runtimeEnv: Record<string, string>;
} | null = null;

jest.mock('../../install/install-state', () => ({
  INSTALLER_MANAGED_FLAG: 'NODERAX_INSTALLER_MANAGED',
  readInstallState: jest.fn(() => installStateValue),
  writeInstallState: jest.fn((value) => {
    installStateValue = value;
  }),
}));

jest.mock('../../common/utils/smtp.util', () => ({
  verifySmtpConnection: jest.fn(),
}));

describe('PlatformSettingsService', () => {
  let service: PlatformSettingsService;
  const envSnapshot = { ...process.env };

  beforeEach(() => {
    installStateValue = null;
    process.env = { ...envSnapshot };
    delete process.env[INSTALLER_MANAGED_FLAG];
    jest.clearAllMocks();
    service = new PlatformSettingsService();
  });

  afterAll(() => {
    process.env = envSnapshot;
  });

  it('maps mail settings from runtime env', () => {
    process.env.SMTP_HOST = 'smtp.resend.com';
    process.env.SMTP_PORT = '465';
    process.env.SMTP_SECURE = 'true';
    process.env.SMTP_USERNAME = 'resend';
    process.env.SMTP_PASSWORD = 'secret';
    process.env.SMTP_FROM_EMAIL = 'info@noderax.net';
    process.env.SMTP_FROM_NAME = 'Noderax Support';
    process.env.WEB_APP_URL = 'https://app.noderax.net';

    const settings = service.getSettings();

    expect(settings.mail).toEqual({
      smtpHost: 'smtp.resend.com',
      smtpPort: 465,
      smtpSecure: true,
      smtpUsername: 'resend',
      smtpPassword: 'secret',
      fromEmail: 'info@noderax.net',
      fromName: 'Noderax Support',
      webAppUrl: 'https://app.noderax.net',
    });
  });

  it('persists mail settings when installer-managed platform settings are updated', () => {
    process.env[INSTALLER_MANAGED_FLAG] = 'true';

    const response = service.updateSettings(buildPlatformSettings());

    expect(response.mail).toEqual(buildMailDto());
    expect(installStateValue?.runtimeEnv).toMatchObject({
      SMTP_HOST: 'smtp.resend.com',
      SMTP_PORT: '587',
      SMTP_SECURE: 'false',
      SMTP_USERNAME: 'resend',
      SMTP_PASSWORD: 'secret',
      SMTP_FROM_EMAIL: 'info@noderax.net',
      SMTP_FROM_NAME: 'Noderax Support',
      WEB_APP_URL: 'https://app.noderax.net',
    });
  });

  it('validates SMTP using the submitted draft values instead of process env', async () => {
    process.env.SMTP_HOST = 'smtp.process-env.example';
    process.env.SMTP_PORT = '2525';

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

const buildPlatformSettings = () => ({
  app: {
    corsOrigin: '*',
    swaggerEnabled: true,
    swaggerPath: 'docs',
  },
  database: {
    host: '127.0.0.1',
    port: 5432,
    username: 'postgres',
    password: 'postgres',
    database: 'noderax',
    synchronize: false,
    logging: false,
    ssl: false,
  },
  redis: {
    enabled: true,
    url: '',
    host: '127.0.0.1',
    port: 6379,
    password: '',
    db: 0,
    keyPrefix: 'noderax:',
  },
  auth: {
    jwtSecret: 'jwt-secret',
    jwtExpiresIn: '1d',
    bcryptSaltRounds: 12,
  },
  mail: buildMailDto(),
  agents: {
    heartbeatTimeoutSeconds: 90,
    offlineCheckIntervalSeconds: 90,
    realtimePingTimeoutSeconds: 45,
    realtimePingCheckIntervalSeconds: 5,
    taskClaimLeaseSeconds: 60,
    staleTaskCheckIntervalSeconds: 15,
    staleQueuedTaskTimeoutSeconds: 120,
    staleRunningTaskTimeoutSeconds: 1800,
    enableRealtimeTaskDispatch: false,
    enrollmentToken: 'agent-token',
    highCpuThreshold: 90,
  },
});
