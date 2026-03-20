import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS_CONFIG_KEY, redisConfig } from '../config';

type RedisMessageHandler = (payload: Record<string, unknown>) => void;

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis | null;
  private subscriber: Redis | null = null;
  private readonly channelHandlers = new Map<
    string,
    Set<RedisMessageHandler>
  >();

  constructor(private readonly configService: ConfigService) {
    const redis =
      this.configService.getOrThrow<ConfigType<typeof redisConfig>>(
        REDIS_CONFIG_KEY,
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

  async set(
    key: string,
    value: string | Record<string, unknown>,
    ttlSeconds?: number,
  ): Promise<void> {
    if (!this.client) {
      return;
    }

    await this.ensureConnected();
    if (this.client.status !== 'ready') {
      return;
    }

    const serializedValue =
      typeof value === 'string' ? value : JSON.stringify(value);

    if (ttlSeconds && ttlSeconds > 0) {
      await this.client.set(key, serializedValue, 'EX', ttlSeconds);
      return;
    }

    await this.client.set(key, serializedValue);
  }

  async get(key: string): Promise<string | null> {
    if (!this.client) {
      return null;
    }

    await this.ensureConnected();
    if (this.client.status !== 'ready') {
      return null;
    }

    return this.client.get(key);
  }

  async del(key: string): Promise<void> {
    if (!this.client) {
      return;
    }

    await this.ensureConnected();
    if (this.client.status !== 'ready') {
      return;
    }

    await this.client.del(key);
  }

  async subscribe(
    channel: string,
    handler: RedisMessageHandler,
  ): Promise<() => Promise<void>> {
    if (!this.client) {
      return async () => undefined;
    }

    await this.ensureSubscriber();
    if (!this.subscriber || this.subscriber.status !== 'ready') {
      return async () => undefined;
    }

    const existingHandlers = this.channelHandlers.get(channel) ?? new Set();
    const isNewSubscription = existingHandlers.size === 0;
    existingHandlers.add(handler);
    this.channelHandlers.set(channel, existingHandlers);

    if (isNewSubscription) {
      await this.subscriber.subscribe(channel);
    }

    return async () => {
      const handlers = this.channelHandlers.get(channel);
      if (!handlers) {
        return;
      }

      handlers.delete(handler);
      if (handlers.size > 0) {
        return;
      }

      this.channelHandlers.delete(channel);
      if (this.subscriber?.status === 'ready') {
        await this.subscriber.unsubscribe(channel);
      }
    };
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

  private async ensureSubscriber() {
    if (!this.client) {
      return;
    }

    if (!this.subscriber) {
      this.subscriber = this.client.duplicate();
      this.subscriber.on('error', (error) => {
        this.logger.warn(`Redis subscriber error: ${error.message}`);
      });
      this.subscriber.on('message', (channel, message) => {
        const handlers = this.channelHandlers.get(channel);
        if (!handlers || handlers.size === 0) {
          return;
        }

        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(message) as Record<string, unknown>;
        } catch {
          this.logger.warn(
            `Redis subscriber received invalid JSON on channel ${channel}`,
          );
          return;
        }

        for (const handler of handlers) {
          handler(payload);
        }
      });
    }

    if (['wait', 'end'].includes(this.subscriber.status)) {
      try {
        await this.subscriber.connect();
      } catch (error) {
        this.logger.warn(
          `Redis subscriber connect skipped: ${(error as Error).message}`,
        );
      }
    }
  }

  async onModuleDestroy() {
    if (this.subscriber) {
      try {
        if (
          ['ready', 'connect', 'reconnecting'].includes(this.subscriber.status)
        ) {
          await this.subscriber.quit();
        } else {
          this.subscriber.disconnect(false);
        }
      } catch (error) {
        this.logger.warn(
          `Redis subscriber shutdown skipped: ${(error as Error).message}`,
        );
      }
    }

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
