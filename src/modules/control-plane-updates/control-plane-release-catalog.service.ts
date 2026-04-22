import { Injectable, Logger } from '@nestjs/common';
import { ControlPlaneReleaseDto } from './dto/control-plane-update.dto';

type ReleaseCache = {
  checkedAt: Date;
  release: ControlPlaneReleaseDto | null;
};

type ManifestReleaseCache = {
  checkedAt: Date;
  release: ControlPlaneReleaseDto | null;
};

const OFFICIAL_LATEST_RELEASE_MANIFEST_URL =
  'https://cdn.noderax.net/noderax-platform/releases/latest/release-manifest.json';
const OFFICIAL_RELEASES_BASE_URL =
  'https://cdn.noderax.net/noderax-platform/releases';
const RELEASE_CACHE_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;

@Injectable()
export class ControlPlaneReleaseCatalogService {
  private readonly logger = new Logger(ControlPlaneReleaseCatalogService.name);
  private cache: ReleaseCache | null = null;
  private readonly manifestCache = new Map<string, ManifestReleaseCache>();

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

  async hydrateRelease(
    release: ControlPlaneReleaseDto | null,
  ): Promise<ControlPlaneReleaseDto | null> {
    if (!release) {
      return null;
    }

    const manifestUrls = this.resolveManifestUrls(release);

    for (const manifestUrl of manifestUrls) {
      const cached = this.manifestCache.get(manifestUrl);
      if (cached && !this.isCacheStale(cached)) {
        if (cached.release) {
          return this.mergeRelease(release, cached.release);
        }
        continue;
      }

      try {
        const manifest = await this.fetchJson<unknown>(manifestUrl);
        const normalized = this.normalizeRelease(manifest, manifestUrl);
        this.manifestCache.set(manifestUrl, {
          checkedAt: new Date(),
          release: normalized,
        });

        if (normalized) {
          return this.mergeRelease(release, normalized);
        }
      } catch (error) {
        this.logger.warn(
          `Control-plane release manifest lookup failed for ${manifestUrl}: ${this.describeError(
            error,
          )}`,
        );
        this.manifestCache.set(manifestUrl, {
          checkedAt: new Date(),
          release: null,
        });
      }
    }

    return release;
  }

  private async fetchLatestRelease(): Promise<ControlPlaneReleaseDto | null> {
    const manifest = await this.fetchJson<unknown>(
      OFFICIAL_LATEST_RELEASE_MANIFEST_URL,
    );
    return this.normalizeRelease(
      manifest,
      OFFICIAL_LATEST_RELEASE_MANIFEST_URL,
    );
  }

  private normalizeRelease(
    value: unknown,
    manifestUrlHint?: string,
  ): ControlPlaneReleaseDto | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const record = value as Record<string, unknown>;
    const version = this.readString(record.platformVersion);
    const releaseId =
      this.readString(record.releaseId) ??
      this.readString(record.platformVersion);

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
        this.readString(record.manifestUrl) ??
        manifestUrlHint ??
        this.buildVersionManifestUrl(version),
      changelog: this.readChangelog(record.changelog),
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

  private resolveManifestUrls(release: ControlPlaneReleaseDto) {
    const urls = new Set<string>();
    const versionManifestUrl = this.buildVersionManifestUrl(release.version);

    if (versionManifestUrl) {
      urls.add(versionManifestUrl);
    }

    if (release.manifestUrl) {
      urls.add(release.manifestUrl);
    }

    return Array.from(urls);
  }

  private buildVersionManifestUrl(version: string | null | undefined) {
    const normalizedVersion = this.readString(version);
    const baseUrl = this.readString(process.env.NODERAX_CDN_BASE_URL);

    if (!normalizedVersion) {
      return null;
    }

    return `${
      baseUrl ?? OFFICIAL_RELEASES_BASE_URL.replace(/\/releases$/, '')
    }/releases/${encodeURIComponent(normalizedVersion)}/release-manifest.json`;
  }

  private mergeRelease(
    base: ControlPlaneReleaseDto,
    hydrated: ControlPlaneReleaseDto,
  ): ControlPlaneReleaseDto {
    return {
      version: hydrated.version || base.version,
      releaseId: hydrated.releaseId || base.releaseId,
      releasedAt: hydrated.releasedAt ?? base.releasedAt ?? null,
      builtAt: hydrated.builtAt ?? base.builtAt ?? null,
      bundleSha256: hydrated.bundleSha256 ?? base.bundleSha256 ?? null,
      bundleUrl: hydrated.bundleUrl ?? base.bundleUrl ?? null,
      manifestUrl: hydrated.manifestUrl ?? base.manifestUrl ?? null,
      changelog:
        hydrated.changelog && hydrated.changelog.length
          ? hydrated.changelog
          : (base.changelog ?? null),
    };
  }

  private readString(value: unknown) {
    return typeof value === 'string' && value.trim().length
      ? value.trim()
      : null;
  }

  private readChangelog(value: unknown) {
    if (!Array.isArray(value)) {
      return null;
    }

    const sections = value
      .map((section) => {
        if (!section || typeof section !== 'object' || Array.isArray(section)) {
          return null;
        }

        const record = section as Record<string, unknown>;
        const title = this.readString(record.title);
        const items = Array.isArray(record.items)
          ? record.items
              .map((item) => this.readString(item))
              .filter((item): item is string => Boolean(item))
          : [];

        if (!title || items.length === 0) {
          return null;
        }

        return {
          title,
          items,
        };
      })
      .filter(
        (
          section,
        ): section is NonNullable<
          ReturnType<ControlPlaneReleaseCatalogService['readChangelog']>
        >[number] => Boolean(section),
      );

    return sections.length ? sections : null;
  }

  private describeError(error: unknown) {
    return error instanceof Error ? error.message : 'Unknown error';
  }
}
