import { Injectable, Logger } from '@nestjs/common';
import { ControlPlaneReleaseDto } from './dto/control-plane-update.dto';

type ReleaseCache = {
  checkedAt: Date;
  release: ControlPlaneReleaseDto | null;
};

const OFFICIAL_LATEST_RELEASE_MANIFEST_URL =
  'https://cdn.noderax.net/noderax-platform/releases/latest/release-manifest.json';
const RELEASE_CACHE_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;

@Injectable()
export class ControlPlaneReleaseCatalogService {
  private readonly logger = new Logger(ControlPlaneReleaseCatalogService.name);
  private cache: ReleaseCache | null = null;

  async getLatestRelease(forceRefresh = false): Promise<{
    release: ControlPlaneReleaseDto | null;
    checkedAt: Date | null;
  }> {
    if (!forceRefresh && this.cache && !this.isCacheStale(this.cache)) {
      return {
        release: this.cache.release,
        checkedAt: this.cache.checkedAt,
      };
    }

    try {
      const release = await this.fetchLatestRelease();
      this.cache = {
        checkedAt: new Date(),
        release,
      };
    } catch (error) {
      this.logger.warn(
        `Control-plane release lookup failed: ${this.describeError(error)}`,
      );

      if (!this.cache) {
        this.cache = {
          checkedAt: new Date(),
          release: null,
        };
      }
    }

    return {
      release: this.cache?.release ?? null,
      checkedAt: this.cache?.checkedAt ?? null,
    };
  }

  private async fetchLatestRelease(): Promise<ControlPlaneReleaseDto | null> {
    const manifest = await this.fetchJson<unknown>(
      OFFICIAL_LATEST_RELEASE_MANIFEST_URL,
    );
    return this.normalizeRelease(manifest);
  }

  private normalizeRelease(value: unknown): ControlPlaneReleaseDto | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const record = value as Record<string, unknown>;
    const version = this.readString(record.platformVersion);
    const releaseId =
      this.readString(record.releaseId) ?? this.readString(record.platformVersion);

    if (!version || !releaseId) {
      return null;
    }

    return {
      version,
      releaseId,
      releasedAt: this.readString(record.releasedAt),
      builtAt: this.readString(record.builtAt),
      bundleSha256: this.readString(record.bundleSha256),
      bundleUrl: this.readString(record.bundleUrl),
      manifestUrl:
        this.readString(record.manifestUrl) ?? OFFICIAL_LATEST_RELEASE_MANIFEST_URL,
    };
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'noderax-api',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} from ${url}`);
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  private isCacheStale(cache: ReleaseCache) {
    return Date.now() - cache.checkedAt.getTime() > RELEASE_CACHE_TTL_MS;
  }

  private readString(value: unknown) {
    return typeof value === 'string' && value.trim().length ? value.trim() : null;
  }

  private describeError(error: unknown) {
    return error instanceof Error ? error.message : 'Unknown error';
  }
}
