import { MailSettingsDto } from '../../common/dto/mail-settings.dto';
import { verifySmtpConnection } from '../../common/utils/smtp.util';
import { INSTALLER_MANAGED_FLAG } from '../../install/install-state';
import { PlatformSettingsService } from './platform-settings.service';

let installStateValue: {
  version: number;
  source: 'installer';
  installedAt: string;
  managedEnv?: Record<string, string>;
  runtimeEnv?: Record<string, string>;
} | null = null;
let installSecretsValue: {
  version: number;
  source: 'installer';
  updatedAt: string;
  secrets: Record<string, string>;
} | null = null;

jest.mock('../../install/install-state', () => ({
  INSTALLER_MANAGED_FLAG: 'NODERAX_INSTALLER_MANAGED',
  readInstallState: jest.fn(() => installStateValue),
  readInstallSecrets: jest.fn(() => installSecretsValue),
  readManagedInstallEnv: jest.fn(
    (value) => value?.managedEnv ?? value?.runtimeEnv ?? {},
  ),
  splitInstallerEnv: jest.fn((input) => ({
    managedEnv: Object.fromEntries(
      Object.entries(input).filter(
        ([key]) =>
          ![
            'DB_PASSWORD',
            'DATABASE_PASSWORD',
            'JWT_SECRET',
            'SMTP_PASSWORD',
            'AGENT_ENROLLMENT_TOKEN',
          ].includes(key),
      ),
    ),
    secretEnv: Object.fromEntries(
      Object.entries(input).filter(([key]) =>
        [
          'DB_PASSWORD',
          'DATABASE_PASSWORD',
          'JWT_SECRET',
          'SMTP_PASSWORD',
          'AGENT_ENROLLMENT_TOKEN',
        ].includes(key),
      ),
    ),
  })),
  writeInstallState: jest.fn((value) => {
    installStateValue = value;
  }),
  writeInstallSecrets: jest.fn((value) => {
    installSecretsValue = {
      version: 1,
      source: 'installer',
      updatedAt: new Date().toISOString(),
      secrets: value,
    };
  }),
}));

jest.mock('../../common/utils/smtp.util', () => ({
  verifySmtpConnection: jest.fn(),
}));

describe('PlatformSettingsService', () => {
  let service: PlatformSettingsService;
  const auditLogsService = {
    record: jest.fn(),
  };
  const envSnapshot = { ...process.env };

  beforeEach(() => {
    installStateValue = null;
    installSecretsValue = null;
    process.env = { ...envSnapshot };
    delete process.env[INSTALLER_MANAGED_FLAG];
    jest.clearAllMocks();
    jest.useRealTimers();
    service = new PlatformSettingsService(auditLogsService as never);
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
    expect(response.restartRequired).toBe(true);
    expect(
      installStateValue?.managedEnv ?? installStateValue?.runtimeEnv,
    ).toMatchObject({
      SMTP_HOST: 'smtp.resend.com',
      SMTP_PORT: '587',
      SMTP_SECURE: 'false',
      SMTP_USERNAME: 'resend',
      SMTP_FROM_EMAIL: 'info@noderax.net',
      SMTP_FROM_NAME: 'Noderax Support',
      WEB_APP_URL: 'https://app.noderax.net',
    });
    expect(installSecretsValue?.secrets).toMatchObject({
      SMTP_PASSWORD: 'secret',
    });
  });

  it('reports installer-managed settings as active once process env matches install state', () => {
    installStateValue = {
      version: 1,
      source: 'installer',
      installedAt: new Date().toISOString(),
      managedEnv: buildRuntimeEnv(),
    };
    process.env = {
      ...process.env,
      ...(installStateValue.managedEnv ?? installStateValue.runtimeEnv),
      [INSTALLER_MANAGED_FLAG]: 'true',
    };

    const settings = service.getSettings();

    expect(settings.restartRequired).toBe(false);
    expect(settings.message).toBe('Installer-managed settings are active.');
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

  it('schedules a single process restart and records an audit event', () => {
    jest.useFakeTimers();
    const killSpy = jest
      .spyOn(process, 'kill')
      .mockImplementation(() => true as never);

    service.scheduleApiRestart({
      id: 'user-1',
      email: 'admin@noderax.net',
    } as never);
    service.scheduleApiRestart({
      id: 'user-1',
      email: 'admin@noderax.net',
    } as never);

    jest.advanceTimersByTime(250);

    expect(killSpy).toHaveBeenCalledTimes(1);
    expect(killSpy).toHaveBeenCalledWith(process.pid, 'SIGTERM');
    expect(auditLogsService.record).toHaveBeenCalledTimes(1);
    expect(service.createRestartResponse().message).toContain(
      'already in progress',
    );

    killSpy.mockRestore();
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

const buildRuntimeEnv = () => ({
  CORS_ORIGIN: '*',
  SWAGGER_ENABLED: 'true',
  SWAGGER_PATH: 'docs',
  DB_HOST: '127.0.0.1',
  DB_PORT: '5432',
  DB_USERNAME: 'postgres',
  DB_PASSWORD: 'postgres',
  DB_NAME: 'noderax',
  DB_SYNCHRONIZE: 'false',
  DB_LOGGING: 'false',
  DB_SSL: 'false',
  REDIS_ENABLED: 'true',
  REDIS_URL: '',
  REDIS_HOST: '127.0.0.1',
  REDIS_PORT: '6379',
  REDIS_PASSWORD: '',
  REDIS_DB: '0',
  REDIS_KEY_PREFIX: 'noderax:',
  JWT_SECRET: 'jwt-secret',
  JWT_EXPIRES_IN: '1d',
  BCRYPT_SALT_ROUNDS: '12',
  SMTP_HOST: 'smtp.resend.com',
  SMTP_PORT: '587',
  SMTP_SECURE: 'false',
  SMTP_USERNAME: 'resend',
  SMTP_PASSWORD: 'secret',
  SMTP_FROM_EMAIL: 'info@noderax.net',
  SMTP_FROM_NAME: 'Noderax Support',
  WEB_APP_URL: 'https://app.noderax.net',
  AGENT_HEARTBEAT_TIMEOUT_SECONDS: '90',
  AGENT_OFFLINE_CHECK_INTERVAL_SECONDS: '90',
  AGENT_REALTIME_PING_TIMEOUT_SECONDS: '45',
  AGENT_REALTIME_PING_CHECK_INTERVAL_SECONDS: '5',
  AGENT_TASK_CLAIM_LEASE_SECONDS: '60',
  AGENT_STALE_TASK_CHECK_INTERVAL_SECONDS: '15',
  AGENT_STALE_QUEUED_TASK_TIMEOUT_SECONDS: '120',
  AGENT_STALE_RUNNING_TASK_TIMEOUT_SECONDS: '1800',
  ENABLE_REALTIME_TASK_DISPATCH: 'false',
  AGENT_ENROLLMENT_TOKEN: 'agent-token',
  AGENT_HIGH_CPU_THRESHOLD: '90',
});
