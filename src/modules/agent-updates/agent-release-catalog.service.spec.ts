import { AgentReleaseCatalogService } from './agent-release-catalog.service';

describe('AgentReleaseCatalogService', () => {
  it('returns an empty catalog instead of throwing when every upstream source fails', async () => {
    const service = new AgentReleaseCatalogService();
    jest
      .spyOn(service as any, 'refreshCatalog')
      .mockImplementation(async () => {
        throw new Error('status=404');
      });

    const catalog = await service.getCatalog(true);

    expect(catalog.releases).toEqual([]);
    expect(catalog.checkedAt).toEqual(expect.any(Date));
  });

  it('returns stale cached releases when refresh fails after a prior success', async () => {
    const service = new AgentReleaseCatalogService();
    const staleCheckedAt = new Date(Date.now() - 10 * 60 * 1000);
    (
      service as unknown as {
        cache: {
          checkedAt: Date;
          releases: Array<{
            version: string;
            publishedAt: string;
            commit: string;
            channel: 'tag';
            notes: Array<{ title: string; items: string[] }>;
            artifacts: {
              amd64: {
                binaryUrl: string;
                sha256: string;
              };
            };
          }>;
        };
      }
    ).cache = {
      checkedAt: staleCheckedAt,
      releases: [
        {
          version: '1.0.0',
          publishedAt: '2026-04-01T00:00:00.000Z',
          commit: 'abc123',
          channel: 'tag',
          notes: [{ title: 'Added', items: ['Initial release'] }],
          artifacts: {
            amd64: {
              binaryUrl: 'https://cdn.example.com/agent',
              sha256: 'deadbeef',
            },
          },
        },
      ],
    };

    jest
      .spyOn(service as any, 'refreshCatalog')
      .mockImplementation(async () => {
        throw new Error('temporary upstream failure');
      });

    const catalog = await service.getCatalog();

    expect(catalog.releases[0]?.version).toBe('1.0.0');
    expect(catalog.checkedAt).toBe(staleCheckedAt);
  });
});
