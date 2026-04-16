import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ConflictException } from '@nestjs/common';
import {
  readPlatformUpdateRequestState,
  readPlatformUpdateState,
  writePlatformUpdateRequestState,
  writePlatformUpdateState,
} from '../../install/install-state';
import { ControlPlaneReleaseCatalogService } from './control-plane-release-catalog.service';
import { ControlPlaneUpdatesService } from './control-plane-updates.service';

describe('ControlPlaneUpdatesService', () => {
  const originalEnv = process.env;

  let stateDir: string;
  let releaseCatalogService: jest.Mocked<ControlPlaneReleaseCatalogService>;
  let agentUpdatesService: { findActiveRollout: jest.Mock };
  let auditLogsService: { record: jest.Mock };
  let service: ControlPlaneUpdatesService;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'noderax-control-plane-updates-'));
    process.env = {
      ...originalEnv,
      NODERAX_STATE_DIR: stateDir,
      NODERAX_PLATFORM_DEPLOYMENT_MODE: 'installer_managed',
      NODERAX_PLATFORM_VERSION: '1.0.0',
      NODERAX_PLATFORM_RELEASE_ID: 'release-current',
      NODERAX_PLATFORM_RELEASED_AT: '2026-04-12T11:00:00Z',
      NODERAX_PLATFORM_BUNDLE_SHA256: 'sha-current',
    };

    releaseCatalogService = {
      getLatestRelease: jest.fn(),
    } as unknown as jest.Mocked<ControlPlaneReleaseCatalogService>;

    agentUpdatesService = {
      findActiveRollout: jest.fn().mockResolvedValue(null),
    };

    auditLogsService = {
      record: jest.fn().mockResolvedValue(undefined),
    };

    service = new ControlPlaneUpdatesService(
      releaseCatalogService,
      agentUpdatesService as never,
      auditLogsService as never,
    );
  });

  afterEach(() => {
    rmSync(stateDir, { recursive: true, force: true });
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it('reports an available update when the version is unchanged but releaseId differs', async () => {
    releaseCatalogService.getLatestRelease.mockResolvedValue({
      checkedAt: new Date('2026-04-12T12:00:00Z'),
      release: {
        version: '1.0.0',
        releaseId: 'release-next',
        releasedAt: '2026-04-12T12:00:00Z',
        builtAt: '2026-04-12T12:00:00Z',
        bundleSha256: 'sha-next',
        bundleUrl:
          'https://cdn.noderax.net/noderax-platform/releases/by-id/release-next/platform-bundle.tar.zst',
        manifestUrl:
          'https://cdn.noderax.net/noderax-platform/releases/by-id/release-next/release-manifest.json',
      },
    });

    const summary = await service.getSummary();

    expect(summary.supported).toBe(true);
    expect(summary.currentRelease?.version).toBe('1.0.0');
    expect(summary.currentRelease?.releaseId).toBe('release-current');
    expect(summary.latestRelease?.version).toBe('1.0.0');
    expect(summary.latestRelease?.releaseId).toBe('release-next');
    expect(summary.updateAvailable).toBe(true);
  });

  it('does not report an update when the releaseId is unchanged', async () => {
    releaseCatalogService.getLatestRelease.mockResolvedValue({
      checkedAt: new Date('2026-04-12T12:00:00Z'),
      release: {
        version: '1.0.0',
        releaseId: 'release-current',
        releasedAt: '2026-04-12T12:00:00Z',
        builtAt: '2026-04-12T12:00:00Z',
        bundleSha256: 'sha-current',
        bundleUrl:
          'https://cdn.noderax.net/noderax-platform/releases/by-id/release-current/platform-bundle.tar.zst',
        manifestUrl:
          'https://cdn.noderax.net/noderax-platform/releases/by-id/release-current/release-manifest.json',
      },
    });

    const summary = await service.getSummary();

    expect(summary.updateAvailable).toBe(false);
    expect(summary.preparedRelease).toBeNull();
  });

  it('rejects apply when an agent rollout is still active', async () => {
    writePlatformUpdateState({
      operation: 'download',
      status: 'prepared',
      requestedAt: '2026-04-12T11:50:00Z',
      startedAt: '2026-04-12T11:50:10Z',
      completedAt: '2026-04-12T11:52:00Z',
      requestedByUserId: 'user-1',
      requestedByEmailSnapshot: 'admin@noderax.test',
      currentRelease: {
        version: '1.0.0',
        releaseId: 'release-current',
        releasedAt: '2026-04-12T11:00:00Z',
        bundleSha256: 'sha-current',
        builtAt: null,
        bundleUrl: null,
        manifestUrl: null,
      },
      targetRelease: {
        version: '1.0.0',
        releaseId: 'release-next',
        releasedAt: '2026-04-12T12:00:00Z',
        bundleSha256: 'sha-next',
        builtAt: null,
        bundleUrl: null,
        manifestUrl: null,
      },
      preparedRelease: {
        version: '1.0.0',
        releaseId: 'release-next',
        releasedAt: '2026-04-12T12:00:00Z',
        bundleSha256: 'sha-next',
        builtAt: null,
        bundleUrl: null,
        manifestUrl: null,
      },
      previousRelease: {
        version: '1.0.0',
        releaseId: 'release-current',
        releasedAt: '2026-04-12T11:00:00Z',
        bundleSha256: 'sha-current',
        builtAt: null,
        bundleUrl: null,
        manifestUrl: null,
      },
      message: 'Prepared release is ready.',
      error: null,
      rollbackStatus: 'not_needed',
      auditLoggedAt: null,
    });

    releaseCatalogService.getLatestRelease.mockResolvedValue({
      checkedAt: new Date('2026-04-12T12:00:00Z'),
      release: {
        version: '1.0.0',
        releaseId: 'release-next',
        releasedAt: '2026-04-12T12:00:00Z',
        builtAt: '2026-04-12T12:00:00Z',
        bundleSha256: 'sha-next',
        bundleUrl:
          'https://cdn.noderax.net/noderax-platform/releases/by-id/release-next/platform-bundle.tar.zst',
        manifestUrl:
          'https://cdn.noderax.net/noderax-platform/releases/by-id/release-next/release-manifest.json',
      },
    });
    agentUpdatesService.findActiveRollout.mockResolvedValue({
      id: 'rollout-1',
      targetVersion: '1.2.3',
    });

    await expect(
      service.queueApply({
        actorType: 'user',
        actorUserId: 'user-1',
        actorEmailSnapshot: 'admin@noderax.test',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.queueApply({
        actorType: 'user',
        actorUserId: 'user-1',
        actorEmailSnapshot: 'admin@noderax.test',
      }),
    ).rejects.toThrow(
      'Agent rollout 1.2.3 is still active. Finish or cancel the rollout before applying a control-plane update.',
    );
  });

  it('clears stale no-op apply state when the installed release already matches the target', async () => {
    writePlatformUpdateState({
      operation: 'apply',
      status: 'recreating_services',
      requestedAt: '2026-04-15T19:51:55.838Z',
      startedAt: '2026-04-15T19:51:56Z',
      completedAt: null,
      requestedByUserId: 'user-1',
      requestedByEmailSnapshot: 'admin@noderax.test',
      currentRelease: {
        version: '1.0.0',
        releaseId: 'release-current',
        releasedAt: '2026-04-12T11:00:00Z',
        bundleSha256: 'sha-current',
        builtAt: null,
        bundleUrl: null,
        manifestUrl: null,
      },
      targetRelease: {
        version: '1.0.0',
        releaseId: 'release-current',
        releasedAt: '2026-04-12T11:00:00Z',
        bundleSha256: 'sha-current',
        builtAt: null,
        bundleUrl: null,
        manifestUrl: null,
      },
      preparedRelease: {
        version: '1.0.0',
        releaseId: 'release-current',
        releasedAt: '2026-04-12T11:00:00Z',
        bundleSha256: 'sha-current',
        builtAt: null,
        bundleUrl: null,
        manifestUrl: null,
      },
      previousRelease: {
        version: '1.0.0',
        releaseId: 'release-current',
        releasedAt: '2026-04-12T11:00:00Z',
        bundleSha256: 'sha-current',
        builtAt: null,
        bundleUrl: null,
        manifestUrl: null,
      },
      message: 'Rolling the runtime services onto the prepared control-plane release.',
      error: null,
      rollbackStatus: null,
      auditLoggedAt: null,
    });

    writePlatformUpdateRequestState({
      requestId: 'request-1',
      operation: 'apply',
      requestedAt: '2026-04-15T19:51:55.838Z',
      requestedByUserId: 'user-1',
      requestedByEmailSnapshot: 'admin@noderax.test',
      targetReleaseId: 'release-current',
    });

    releaseCatalogService.getLatestRelease.mockResolvedValue({
      checkedAt: new Date('2026-04-15T20:00:00Z'),
      release: {
        version: '1.0.0',
        releaseId: 'release-current',
        releasedAt: '2026-04-15T20:00:00Z',
        builtAt: '2026-04-15T20:00:00Z',
        bundleSha256: 'sha-current',
        bundleUrl:
          'https://cdn.noderax.net/noderax-platform/releases/by-id/release-current/platform-bundle.tar.zst',
        manifestUrl:
          'https://cdn.noderax.net/noderax-platform/releases/by-id/release-current/release-manifest.json',
      },
    });

    const summary = await service.getSummary();

    expect(summary.preparedRelease).toBeNull();
    expect(summary.operation).toBeNull();
    expect(summary.updateAvailable).toBe(false);
    expect(readPlatformUpdateState()).toBeNull();
    expect(readPlatformUpdateRequestState()).toBeNull();
  });

  it('marks a stale active apply as failed when the target release never became active', async () => {
    writePlatformUpdateState({
      operation: 'apply',
      status: 'recreating_services',
      requestedAt: '2026-04-15T19:00:00.000Z',
      startedAt: '2026-04-15T19:00:05.000Z',
      completedAt: null,
      requestedByUserId: 'user-1',
      requestedByEmailSnapshot: 'admin@noderax.test',
      currentRelease: {
        version: '1.0.0',
        releaseId: 'release-current',
        releasedAt: '2026-04-12T11:00:00Z',
        bundleSha256: 'sha-current',
        builtAt: null,
        bundleUrl: null,
        manifestUrl: null,
      },
      targetRelease: {
        version: '1.0.0',
        releaseId: 'release-next',
        releasedAt: '2026-04-12T12:00:00Z',
        bundleSha256: 'sha-next',
        builtAt: null,
        bundleUrl: null,
        manifestUrl: null,
      },
      preparedRelease: {
        version: '1.0.0',
        releaseId: 'release-next',
        releasedAt: '2026-04-12T12:00:00Z',
        bundleSha256: 'sha-next',
        builtAt: null,
        bundleUrl: null,
        manifestUrl: null,
      },
      previousRelease: {
        version: '1.0.0',
        releaseId: 'release-current',
        releasedAt: '2026-04-12T11:00:00Z',
        bundleSha256: 'sha-current',
        builtAt: null,
        bundleUrl: null,
        manifestUrl: null,
      },
      message: 'Rolling the runtime services onto the prepared control-plane release.',
      error: null,
      rollbackStatus: null,
      auditLoggedAt: null,
    });

    writePlatformUpdateRequestState({
      requestId: 'request-2',
      operation: 'apply',
      requestedAt: '2026-04-15T19:00:00.000Z',
      requestedByUserId: 'user-1',
      requestedByEmailSnapshot: 'admin@noderax.test',
      targetReleaseId: 'release-next',
    });

    releaseCatalogService.getLatestRelease.mockResolvedValue({
      checkedAt: new Date('2026-04-15T20:30:00Z'),
      release: {
        version: '1.0.0',
        releaseId: 'release-next',
        releasedAt: '2026-04-15T20:30:00Z',
        builtAt: '2026-04-15T20:30:00Z',
        bundleSha256: 'sha-next',
        bundleUrl:
          'https://cdn.noderax.net/noderax-platform/releases/by-id/release-next/platform-bundle.tar.zst',
        manifestUrl:
          'https://cdn.noderax.net/noderax-platform/releases/by-id/release-next/release-manifest.json',
      },
    });

    jest.useFakeTimers().setSystemTime(new Date('2026-04-15T20:30:00Z'));

    const summary = await service.getSummary();

    expect(summary.operation?.status).toBe('failed');
    expect(summary.operation?.message).toContain('timed out');
    expect(summary.preparedRelease?.releaseId).toBe('release-next');
    expect(readPlatformUpdateRequestState()).toBeNull();
    expect(readPlatformUpdateState()?.status).toBe('failed');

    jest.useRealTimers();
  });
});
