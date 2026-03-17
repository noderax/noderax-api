import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis | null;

  constructor(private readonly configService: ConfigService) {
    const redis = this.configService.get('redis');

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
    return this.client.publish(channel, JSON.stringify(payload));
  }

  isEnabled() {
    return !!this.client;
  }

  private async ensureConnected() {
    if (!this.client || this.client.status !== 'wait') {
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

    await this.client.quit();
  }
}
