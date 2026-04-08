import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import {
  DependencyHealthResponseDto,
  ReadinessResponseDto,
} from './common/dto/dependency-health-response.dto';
import { HealthResponseDto } from './common/dto/health-response.dto';
import { getInstallStateHealth } from './install/install-state';
import { RedisService } from './redis/redis.service';

@Injectable()
export class AppService {
  private readonly startedAt = new Date().toISOString();
  private readonly bootId = randomUUID();

  constructor(
    private readonly dataSource: DataSource,
    private readonly redisService: RedisService,
  ) {}

  getHealth(): HealthResponseDto {
    return {
      service: 'noderax-api',
      status: 'ok',
      timestamp: new Date().toISOString(),
      startedAt: this.startedAt,
      bootId: this.bootId,
    };
  }

  async getReadiness(): Promise<ReadinessResponseDto> {
    const checks = await this.buildDependencyChecks();
    const ready = Object.values(checks).every((check) => check.healthy);

    return {
      service: 'noderax-api',
      status: ready ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      ready,
      checks,
    };
  }

  async getDependencyHealth(): Promise<DependencyHealthResponseDto> {
    const checks = await this.buildDependencyChecks();
    const healthy = Object.values(checks).every((check) => check.healthy);

    return {
      service: 'noderax-api',
      status: healthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      checks,
    };
  }

  private async buildDependencyChecks() {
    const installStateHealth = getInstallStateHealth();
    const databaseReady = await this.checkDatabase();
    const redisReady = await this.checkRedis();
    const migrationsReady = await this.checkMigrations();

    return {
      database: databaseReady,
      redis: redisReady,
      installState: installStateHealth.writable
        ? {
            healthy: true,
            status: 'ready',
            detail: installStateHealth.path,
          }
        : {
            healthy: false,
            status: 'unwritable',
            detail: installStateHealth.error,
          },
      migrations: migrationsReady,
    };
  }

  private async checkDatabase() {
    try {
      if (!this.dataSource.isInitialized) {
        return {
          healthy: false,
          status: 'not_initialized',
          detail: 'TypeORM datasource is not initialized.',
        };
      }

      await this.dataSource.query('SELECT 1');
      return {
        healthy: true,
        status: 'ready',
        detail: null,
      };
    } catch (error) {
      return {
        healthy: false,
        status: 'error',
        detail: (error as Error).message,
      };
    }
  }

  private async checkRedis() {
    if (!this.redisService.isEnabled()) {
      return {
        healthy: true,
        status: 'disabled',
        detail: 'Redis integration is disabled.',
      };
    }

    const reachable = await this.redisService.ping();
    const snapshot = this.redisService.getHealthSnapshot();
    return reachable
      ? {
          healthy: true,
          status: snapshot.status,
          detail: `subscriber=${snapshot.subscriberStatus}`,
        }
      : {
          healthy: false,
          status: snapshot.status,
          detail: `subscriber=${snapshot.subscriberStatus}`,
        };
  }

  private async checkMigrations() {
    try {
      if (!this.dataSource.isInitialized) {
        return {
          healthy: false,
          status: 'not_initialized',
          detail: 'Datasource is unavailable for migration checks.',
        };
      }

      const hasPendingMigrations = await this.dataSource.showMigrations();
      return hasPendingMigrations
        ? {
            healthy: false,
            status: 'pending',
            detail: 'Database has pending migrations.',
          }
        : {
            healthy: true,
            status: 'ready',
            detail: null,
          };
    } catch (error) {
      return {
        healthy: false,
        status: 'error',
        detail: (error as Error).message,
      };
    }
  }
}
