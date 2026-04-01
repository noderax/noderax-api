import { Injectable, Logger } from '@nestjs/common';
import { AgentReleaseDto } from './dto/agent-release.dto';

type ReleaseCatalogCache = {
  checkedAt: Date;
  releases: AgentReleaseDto[];
};

type GithubReleaseAsset = {
  name?: string;
  browser_download_url?: string;
};

type GithubRelease = {
  draft?: boolean;
  prerelease?: boolean;
  tag_name?: string;
  published_at?: string;
  assets?: GithubReleaseAsset[];
};

const OFFICIAL_CDN_CATALOG_URL =
  'https://cdn.noderax.net/noderax-agent/releases/catalog.json';
const OFFICIAL_CDN_RELEASE_MANIFEST = (version: string) =>
  `https://cdn.noderax.net/noderax-agent/releases/${encodeURIComponent(version)}/release-manifest.json`;
const OFFICIAL_GITHUB_RELEASES_URL =
  'https://api.github.com/repos/noderax/noderax-agent/releases?per_page=20';
const OFFICIAL_GITHUB_RELEASE_BY_TAG_URL = (version: string) =>
  `https://api.github.com/repos/noderax/noderax-agent/releases/tags/agent-v${encodeURIComponent(version)}`;
const RELEASE_CACHE_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;
const MANIFEST_ASSET_NAME = 'release-manifest.json';

@Injectable()
export class AgentReleaseCatalogService {
  private readonly logger = new Logger(AgentReleaseCatalogService.name);
  private cache: ReleaseCatalogCache | null = null;

  async getCatalog(forceRefresh = false): Promise<{
    releases: AgentReleaseDto[];
    checkedAt: Date | null;
  }> {
    if (!forceRefresh && this.cache && !this.isCacheStale(this.cache)) {
      return {
        releases: this.cache.releases,
        checkedAt: this.cache.checkedAt,
      };
    }

    const nextCache = await this.refreshCatalog();
    return {
      releases: nextCache.releases,
      checkedAt: nextCache.checkedAt,
    };
  }

  async findRelease(version: string): Promise<AgentReleaseDto | null> {
    const normalizedVersion = version.trim();
    if (!normalizedVersion) {
      return null;
    }

    const { releases } = await this.getCatalog();
    const cached = releases.find(
      (release) => release.version === normalizedVersion,
    );
    if (cached) {
      return cached;
    }

    try {
      return await this.fetchReleaseFromCdn(normalizedVersion);
    } catch (error) {
      this.logger.warn(
        `Failed to resolve release ${normalizedVersion} from CDN: ${this.describeError(error)}`,
      );
    }

    try {
      return await this.fetchReleaseFromGithub(normalizedVersion);
    } catch (error) {
      this.logger.warn(
        `Failed to resolve release ${normalizedVersion} from GitHub: ${this.describeError(error)}`,
      );
      return null;
    }
  }

  private async refreshCatalog(): Promise<ReleaseCatalogCache> {
    try {
      const releases = await this.fetchCatalogFromCdn();
      this.cache = {
        checkedAt: new Date(),
        releases,
      };
      return this.cache;
    } catch (error) {
      this.logger.warn(
        `Falling back to GitHub release catalog: ${this.describeError(error)}`,
      );
    }

    const releases = await this.fetchCatalogFromGithub();
    this.cache = {
      checkedAt: new Date(),
      releases,
    };
    return this.cache;
  }

  private async fetchCatalogFromCdn(): Promise<AgentReleaseDto[]> {
    const payload = await this.fetchJson<unknown>(OFFICIAL_CDN_CATALOG_URL);
    const rawReleases = Array.isArray(payload)
      ? payload
      : payload &&
          typeof payload === 'object' &&
          Array.isArray((payload as { releases?: unknown[] }).releases)
        ? (payload as { releases: unknown[] }).releases
        : [];
    const releases = rawReleases
      .map((value) => this.normalizeManifest(value))
      .filter((value): value is AgentReleaseDto => Boolean(value));

    if (!releases.length) {
      throw new Error('CDN release catalog is empty');
    }

    return this.sortReleases(releases);
  }

  private async fetchCatalogFromGithub(): Promise<AgentReleaseDto[]> {
    const releases = await this.fetchJson<GithubRelease[]>(
      OFFICIAL_GITHUB_RELEASES_URL,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'noderax-api',
        },
      },
    );

    const manifests: AgentReleaseDto[] = [];
    for (const release of releases) {
      if (!this.isSupportedGithubRelease(release)) {
        continue;
      }

      const manifestAsset = release.assets?.find(
        (asset) => asset.name === MANIFEST_ASSET_NAME,
      );
      if (!manifestAsset?.browser_download_url) {
        continue;
      }

      try {
        const manifest = await this.fetchJson<unknown>(
          manifestAsset.browser_download_url,
          {
            headers: {
              Accept: 'application/json',
              'User-Agent': 'noderax-api',
            },
          },
        );
        const normalized = this.normalizeManifest(manifest);
        if (normalized) {
          manifests.push(normalized);
        }
      } catch (error) {
        this.logger.warn(
          `Skipping GitHub release manifest ${release.tag_name ?? 'unknown'}: ${this.describeError(error)}`,
        );
      }
    }

    if (!manifests.length) {
      throw new Error('GitHub release fallback did not return any manifests');
    }

    return this.sortReleases(manifests);
  }

  private async fetchReleaseFromCdn(version: string): Promise<AgentReleaseDto> {
    const manifest = await this.fetchJson<unknown>(
      OFFICIAL_CDN_RELEASE_MANIFEST(version),
    );
    const normalized = this.normalizeManifest(manifest);
    if (!normalized) {
      throw new Error(`CDN manifest for ${version} is invalid`);
    }

    return normalized;
  }

  private async fetchReleaseFromGithub(
    version: string,
  ): Promise<AgentReleaseDto | null> {
    const release = await this.fetchJson<GithubRelease>(
      OFFICIAL_GITHUB_RELEASE_BY_TAG_URL(version),
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'noderax-api',
        },
      },
    );
    if (!this.isSupportedGithubRelease(release)) {
      return null;
    }

    const manifestAsset = release.assets?.find(
      (asset) => asset.name === MANIFEST_ASSET_NAME,
    );
    if (!manifestAsset?.browser_download_url) {
      return null;
    }

    const manifest = await this.fetchJson<unknown>(
      manifestAsset.browser_download_url,
      {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'noderax-api',
        },
      },
    );
    return this.normalizeManifest(manifest);
  }

  private isSupportedGithubRelease(release: GithubRelease): boolean {
    const tagName = release.tag_name?.trim() ?? '';
    return (
      !release.draft &&
      !release.prerelease &&
      /^agent-v[0-9A-Za-z._-]+$/.test(tagName)
    );
  }

  private normalizeManifest(value: unknown): AgentReleaseDto | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const record = value as Record<string, unknown>;
    const version = this.readString(record.version);
    const publishedAt = this.readString(record.publishedAt);
    const commit = this.readString(record.commit);
    const channel = this.readString(record.channel);
    const artifacts = this.normalizeArtifacts(record.artifacts);
    const notes = this.normalizeNotes(record.notes);

    if (
      !version ||
      !publishedAt ||
      !commit ||
      channel !== 'tag' ||
      !artifacts ||
      !notes
    ) {
      return null;
    }

    return {
      version,
      publishedAt,
      commit,
      channel: 'tag',
      artifacts,
      notes,
    };
  }

  private normalizeArtifacts(
    value: unknown,
  ): AgentReleaseDto['artifacts'] | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const record = value as Record<string, unknown>;
    const amd64 = this.normalizeArtifact(record.amd64);
    const arm64 = this.normalizeArtifact(record.arm64);
    if (!amd64 && !arm64) {
      return null;
    }

    return {
      ...(amd64 ? { amd64 } : {}),
      ...(arm64 ? { arm64 } : {}),
    };
  }

  private normalizeArtifact(
    value: unknown,
  ): AgentReleaseDto['artifacts']['amd64'] | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const record = value as Record<string, unknown>;
    const binaryUrl = this.readString(record.binaryUrl);
    const sha256 = this.readString(record.sha256);
    if (!binaryUrl || !sha256) {
      return null;
    }

    return {
      binaryUrl,
      sha256,
    };
  }

  private normalizeNotes(value: unknown): AgentReleaseDto['notes'] | null {
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

        if (!title || !items.length) {
          return null;
        }

        return {
          title,
          items,
        };
      })
      .filter((section): section is AgentReleaseDto['notes'][number] =>
        Boolean(section),
      );

    return sections.length ? sections : null;
  }

  private sortReleases(releases: AgentReleaseDto[]): AgentReleaseDto[] {
    return [...releases].sort((left, right) =>
      right.publishedAt.localeCompare(left.publishedAt),
    );
  }

  private readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : null;
  }

  private isCacheStale(cache: ReleaseCatalogCache): boolean {
    return Date.now() - cache.checkedAt.getTime() > RELEASE_CACHE_TTL_MS;
  }

  private async fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`status=${response.status}`);
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  private describeError(error: unknown): string {
    return error instanceof Error ? error.message : 'unknown error';
  }
}
