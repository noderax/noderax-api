import { DataSource, DataSourceOptions } from 'typeorm';
import appDataSource from '../src/database/typeorm.data-source';
import { ClusterLockService } from '../src/runtime/cluster-lock.service';

describe('ClusterLockService (integration)', () => {
  let dataSource: DataSource;
  let clusterLockService: ClusterLockService;

  beforeAll(async () => {
    dataSource = new DataSource({
      ...(appDataSource.options as DataSourceOptions),
      migrations: [],
      entities: [],
    });
    await dataSource.initialize();
    clusterLockService = new ClusterLockService(dataSource);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  it('allows only one concurrent owner for the same advisory lock', async () => {
    const executed: string[] = [];
    let releaseFirst: (() => void) | null = null;

    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const firstRun = clusterLockService.runWithLock(
      'integration-cluster-lock',
      async () => {
        executed.push('first');
        await firstGate;
      },
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    const secondRun = await clusterLockService.runWithLock(
      'integration-cluster-lock',
      async () => {
        executed.push('second');
      },
    );

    expect(secondRun.acquired).toBe(false);

    releaseFirst?.();
    const firstResult = await firstRun;
    expect(firstResult.acquired).toBe(true);
    expect(executed).toEqual(['first']);

    const thirdRun = await clusterLockService.runWithLock(
      'integration-cluster-lock',
      async () => {
        executed.push('third');
      },
    );

    expect(thirdRun.acquired).toBe(true);
    expect(executed).toEqual(['first', 'third']);
  });
});
