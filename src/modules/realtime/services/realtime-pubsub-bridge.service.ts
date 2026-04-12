import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PUBSUB_CHANNELS } from '../../../common/constants/pubsub.constants';
import { RedisService } from '../../../redis/redis.service';
import { RealtimeGateway } from '../realtime.gateway';

type PubsubPayload = Record<string, unknown> & {
  sourceInstanceId?: string;
};

@Injectable()
export class RealtimePubsubBridgeService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(RealtimePubsubBridgeService.name);
  private readonly unsubscribers: Array<() => Promise<void>> = [];

  constructor(
    private readonly redisService: RedisService,
    private readonly realtimeGateway: RealtimeGateway,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.redisService.isEnabled()) {
      return;
    }

    this.unsubscribers.push(
      await this.redisService.subscribe(
        PUBSUB_CHANNELS.EVENTS_CREATED,
        (payload) => {
          this.forwardEventCreated(payload as PubsubPayload);
        },
      ),
      await this.redisService.subscribe(
        PUBSUB_CHANNELS.NODES_STATUS_UPDATED,
        (payload) => {
          this.forwardNodeStatus(payload as PubsubPayload);
        },
      ),
      await this.redisService.subscribe(
        PUBSUB_CHANNELS.NODES_ROOT_ACCESS_UPDATED,
        (payload) => {
          this.forwardNodeRootAccess(payload as PubsubPayload);
        },
      ),
      await this.redisService.subscribe(
        PUBSUB_CHANNELS.METRICS_INGESTED,
        (payload) => {
          this.forwardMetric(payload as PubsubPayload);
        },
      ),
      await this.redisService.subscribe(
        PUBSUB_CHANNELS.TASKS_CREATED,
        (payload) => {
          this.forwardTaskCreated(payload as PubsubPayload);
        },
      ),
      await this.redisService.subscribe(
        PUBSUB_CHANNELS.TASKS_UPDATED,
        (payload) => {
          this.forwardTaskUpdated(payload as PubsubPayload);
        },
      ),
      await this.redisService.subscribe(
        PUBSUB_CHANNELS.NODE_INSTALLS_UPDATED,
        (payload) => {
          this.forwardNodeInstallUpdated(payload as PubsubPayload);
        },
      ),
    );

    this.logger.log('Realtime pubsub bridge is active');
  }

  async onModuleDestroy(): Promise<void> {
    for (const unsubscribe of this.unsubscribers) {
      await unsubscribe();
    }
    this.unsubscribers.length = 0;
  }

  private forwardNodeStatus(payload: PubsubPayload): void {
    if (this.isSameInstance(payload)) {
      return;
    }

    this.realtimeGateway.emitNodeStatusUpdate(payload);
  }

  private forwardEventCreated(payload: PubsubPayload): void {
    if (this.isSameInstance(payload)) {
      return;
    }

    this.realtimeGateway.emitEventCreated(payload);
  }

  private forwardNodeRootAccess(payload: PubsubPayload): void {
    if (this.isSameInstance(payload)) {
      return;
    }

    this.realtimeGateway.emitNodeRootAccessUpdate(payload);
  }

  private forwardMetric(payload: PubsubPayload): void {
    if (this.isSameInstance(payload)) {
      return;
    }

    this.realtimeGateway.emitMetricIngested(payload);
  }

  private forwardTaskCreated(payload: PubsubPayload): void {
    if (this.isSameInstance(payload)) {
      return;
    }

    this.realtimeGateway.emitTaskCreated(payload);
  }

  private forwardTaskUpdated(payload: PubsubPayload): void {
    if (this.isSameInstance(payload)) {
      return;
    }

    this.realtimeGateway.emitTaskUpdated(payload);
  }

  private forwardNodeInstallUpdated(payload: PubsubPayload): void {
    if (this.isSameInstance(payload)) {
      return;
    }

    this.realtimeGateway.emitNodeInstallUpdated(payload);
  }

  private isSameInstance(payload: PubsubPayload): boolean {
    return payload.sourceInstanceId === this.redisService.getInstanceId();
  }
}
