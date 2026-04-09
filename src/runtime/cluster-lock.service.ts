import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { hostname } from 'os';
import { createHash, randomUUID } from 'crypto';

type ClusterLockSnapshot = {
  lockName: string;
  acquisitions: number;
  skips: number;
  lastAcquiredAt: string | null;
  lastSkippedAt: string | null;
};

@Injectable()
export class ClusterLockService {
  private readonly logger = new Logger(ClusterLockService.name);
  private readonly instanceId = `${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;
  private readonly snapshots = new Map<string, ClusterLockSnapshot>();
  private readonly localLocks = new Set<string>();
  private lockMode: 'auto' | 'advisory' | 'local' = 'auto';

  constructor(private readonly dataSource: DataSource) {}

  getInstanceId(): string {
    return this.instanceId;
  }

  getSnapshots(): ClusterLockSnapshot[] {
    return Array.from(this.snapshots.values()).sort((left, right) =>
      left.lockName.localeCompare(right.lockName),
    );
  }

  async runWithLock<T>(
    lockName: string,
    callback: () => Promise<T>,
  ): Promise<{ acquired: boolean; result?: T }> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();

    let acquired = false;
    let usedLocalFallback = false;

    try {
      if (this.lockMode === 'local') {
        acquired = this.tryAcquireLocalLock(lockName);
        usedLocalFallback = true;
      } else {
        try {
          acquired = await this.tryAcquireAdvisoryLock(queryRunner, lockName);
          this.lockMode = 'advisory';
        } catch (error) {
          if (!this.shouldFallbackToLocalLock(error)) {
            throw error;
          }

          this.lockMode = 'local';
          usedLocalFallback = true;
          acquired = this.tryAcquireLocalLock(lockName);
          this.logger.warn(
            `Cluster lock ${lockName} is using in-process fallback because advisory locks are unavailable in the current database runtime.`,
          );
        }
      }

      if (!acquired) {
        this.recordSkip(lockName);
        return { acquired: false };
      }

      this.recordAcquisition(lockName);
      const result = await callback();
      return { acquired: true, result };
    } catch (error) {
      this.logger.error(
        `Cluster lock ${lockName} failed: ${
          error instanceof Error
            ? (error.stack ?? error.message)
            : String(error)
        }`,
      );
      throw error;
    } finally {
      if (acquired) {
        if (usedLocalFallback || this.lockMode === 'local') {
          this.localLocks.delete(lockName);
        } else {
          await this.releaseAdvisoryLock(queryRunner, lockName).catch(
            (error: unknown) => {
              this.logger.warn(
                `Cluster lock ${lockName} unlock failed: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
            },
          );
        }
      }

      await queryRunner.release();
    }
  }

  private async tryAcquireAdvisoryLock(
    queryRunner: ReturnType<DataSource['createQueryRunner']>,
    lockName: string,
  ): Promise<boolean> {
    const [keyA, keyB] = this.buildLockKey(lockName);
    const rows = (await queryRunner.query(
      `
        SELECT pg_try_advisory_lock($1, $2) AS acquired
      `,
      [keyA, keyB],
    )) as Array<{ acquired: boolean }>;

    return Boolean(rows[0]?.acquired);
  }

  private async releaseAdvisoryLock(
    queryRunner: ReturnType<DataSource['createQueryRunner']>,
    lockName: string,
  ): Promise<void> {
    const [keyA, keyB] = this.buildLockKey(lockName);
    await queryRunner.query(
      `
        SELECT pg_advisory_unlock($1, $2)
      `,
      [keyA, keyB],
    );
  }

  private tryAcquireLocalLock(lockName: string): boolean {
    if (this.localLocks.has(lockName)) {
      return false;
    }

    this.localLocks.add(lockName);
    return true;
  }

  private buildLockKey(lockName: string): [number, number] {
    const digest = createHash('sha256').update(lockName).digest();
    return [digest.readInt32BE(0), digest.readInt32BE(4)];
  }

  private shouldFallbackToLocalLock(error: unknown): boolean {
    const message =
      error instanceof Error ? error.message.toLowerCase() : String(error);

    return (
      message.includes('pg_try_advisory_lock') ||
      message.includes('pg_advisory_unlock') ||
      message.includes('function md5') ||
      message.includes('function does not exist')
    );
  }

  private recordAcquisition(lockName: string): void {
    const current = this.getOrCreateSnapshot(lockName);
    current.acquisitions += 1;
    current.lastAcquiredAt = new Date().toISOString();
    this.snapshots.set(lockName, current);
  }

  private recordSkip(lockName: string): void {
    const current = this.getOrCreateSnapshot(lockName);
    current.skips += 1;
    current.lastSkippedAt = new Date().toISOString();
    this.snapshots.set(lockName, current);
  }

  private getOrCreateSnapshot(lockName: string): ClusterLockSnapshot {
    return (
      this.snapshots.get(lockName) ?? {
        lockName,
        acquisitions: 0,
        skips: 0,
        lastAcquiredAt: null,
        lastSkippedAt: null,
      }
    );
  }
}
