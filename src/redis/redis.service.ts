import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import Redis from 'ioredis';
import { redisConfig } from '../config';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis | null;

  constructor(private readonly configService: ConfigService) {
    const redis = this.configService.getOrThrow<ConfigType<typeof redisConfig>>(
      redisConfig.KEY,
    );

    if (!redis.enabled) {
      this.client = null;
      this.logger.log('Redis integration is disabled');
      return;
    }

    this.client = redis.url
      ? new Redis(redis.url, {
          lazyConnect: true,
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
          keyPrefix: redis.keyPrefix,
        })
      : new Redis({
          host: redis.host,
          port: redis.port,
          password: redis.password || undefined,
          db: redis.db,
          keyPrefix: redis.keyPrefix,
          lazyConnect: true,
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
        });

    this.client.on('error', (error) => {
      this.logger.warn(`Redis error: ${error.message}`);
    });
  }

  async publish(channel: string, payload: Record<string, unknown>) {
    if (!this.client) {
      return 0;
    }

    await this.ensureConnected();

    if (this.client.status !== 'ready') {
      this.logger.warn(
        `Redis publish skipped for channel ${channel}: client is not ready`,
      );
      return 0;
    }

    return this.client.publish(channel, JSON.stringify(payload));
  }

  isEnabled() {
    return !!this.client;
  }

  private async ensureConnected() {
    if (!this.client || !['wait', 'end'].includes(this.client.status)) {
      return;
    }

    try {
      await this.client.connect();
    } catch (error) {
      this.logger.warn(`Redis connect skipped: ${(error as Error).message}`);
    }
  }

  async onModuleDestroy() {
    if (!this.client) {
      return;
    }

    try {
      if (['ready', 'connect', 'reconnecting'].includes(this.client.status)) {
        await this.client.quit();
        return;
      }

      this.client.disconnect(false);
    } catch (error) {
      this.logger.warn(`Redis shutdown skipped: ${(error as Error).message}`);
    }
  }
}
