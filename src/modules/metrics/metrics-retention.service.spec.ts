import { ConflictException } from '@nestjs/common';
import { MetricsRetentionService } from './metrics-retention.service';

let installStateValue: {
  version: number;
  source: 'installer';
  installedAt: string;
  managedEnv?: Record<string, string>;
} | null = null;
let installerManaged = true;

jest.mock('../../install/install-state', () => ({
  isInstallerManagedDeployment: jest.fn(() => installerManaged),
  readInstallState: jest.fn(() => installStateValue),
  readManagedInstallEnv: jest.fn((value) => value?.managedEnv ?? {}),
  writeInstallState: jest.fn((value) => {
    installStateValue = value;
  }),
}));

const buildService = (overrides?: {
  deleteMetricsOlderThan?: jest.Mock;
  runWithLock?: jest.Mock;
}) => {
  const metricsService = {
    deleteMetricsOlderThan:
      overrides?.deleteMetricsOlderThan ?? jest.fn().mockResolvedValue(0),
  };
  const schedulerRegistry = {
    addInterval: jest.fn(),
    deleteInterval: jest.fn(),
    doesExist: jest.fn(() => false),
  };
  const dataSource = {
    query: jest.fn().mockResolvedValue([{ exists: true }]),
  };
  const clusterLockService = {
    runWithLock:
      overrides?.runWithLock ??
      jest.fn(async (_name: string, cb: () => Promise<number>) => ({
        acquired: true,
        result: await cb(),
      })),
  };
  const auditLogsService = { record: jest.fn() };

  const service = new MetricsRetentionService(
    metricsService as never,
    schedulerRegistry as never,
    dataSource as never,
    clusterLockService as never,
    auditLogsService as never,
  );

  return { service, metricsService, clusterLockService, auditLogsService };
};

describe('MetricsRetentionService', () => {
  const envSnapshot = { ...process.env };

  beforeEach(() => {
    installStateValue = {
      version: 2,
      source: 'installer',
      installedAt: '2026-01-01T00:00:00.000Z',
      managedEnv: {},
    };
    installerManaged = true;
    process.env = { ...envSnapshot };
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env = envSnapshot;
  });

  it('defaults to disabled with a 30 day window', () => {
    const { service } = buildService();
    const settings = service.getSettings();

    expect(settings.enabled).toBe(false);
    expect(settings.retentionDays).toBe(30);
    expect(settings.editable).toBe(true);
  });

  it('persists updated settings and reads them back live', () => {
    const { service } = buildService();

    const updated = service.updateSettings({
      enabled: true,
      retentionDays: 45,
    });

    expect(updated.enabled).toBe(true);
    expect(updated.retentionDays).toBe(45);
    expect(service.getSettings().retentionDays).toBe(45);
  });

  it('rejects updates on non-installer deployments', () => {
    installerManaged = false;
    const { service } = buildService();

    expect(() =>
      service.updateSettings({ enabled: true, retentionDays: 30 }),
    ).toThrow(ConflictException);
  });

  it('runCleanupNow deletes using the configured window and returns the count', async () => {
    const deleteMetricsOlderThan = jest.fn().mockResolvedValue(17);
    const { service } = buildService({ deleteMetricsOlderThan });
    service.updateSettings({ enabled: true, retentionDays: 10 });

    const result = await service.runCleanupNow();

    expect(deleteMetricsOlderThan).toHaveBeenCalledWith(10);
    expect(result.deletedCount).toBe(17);
    expect(service.getSettings().lastDeletedCount).toBe(17);
  });
});
