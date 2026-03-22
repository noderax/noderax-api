import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { hostname } from 'os';
import { Repository } from 'typeorm';
import {
  AGENT_REALTIME_REDIS_KEYS,
  AGENT_REALTIME_ROUTE_TTL_SECONDS,
  AGENT_REALTIME_SERVER_EVENTS,
} from '../../common/constants/agent-realtime.constants';
import { AGENTS_CONFIG_KEY, agentsConfig } from '../../config';
import { PUBSUB_CHANNELS } from '../../common/constants/pubsub.constants';
import { RedisService } from '../../redis/redis.service';
import { MetricsService } from '../metrics/metrics.service';
import { NodeEntity } from '../nodes/entities/node.entity';
import { NodeStatus } from '../nodes/entities/node-status.enum';
import { NodesService } from '../nodes/nodes.service';
import { TasksService } from '../tasks/tasks.service';
import { TaskEntity } from '../tasks/entities/task.entity';
import { AgentMetricsDto } from '../metrics/dto/agent-metrics.dto';
import { AgentTaskLifecycleEventEntity } from './entities/agent-task-lifecycle-event.entity';
import { AgentTaskDispatchPayload } from './types/agent-realtime-events.type';

type AgentSocketSession = {
  socketId: string;
  nodeId: string;
  agentToken: string;
  authenticatedAt: Date;
  lastPingAt: Date;
  lastAgentReportedPingAt?: Date;
};

type AgentNodeRoute = {
  instanceId: string;
  socketId: string;
  nodeId: string;
  updatedAt: string;
};

type AgentTaskDispatchRouteMessage = {
  targetInstanceId: string;
  nodeId: string;
  task: AgentTaskDispatchPayload;
};

@Injectable()
export class AgentRealtimeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AgentRealtimeService.name);
  private readonly instanceId = `${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;

  private readonly nodeToSocketId = new Map<string, string>();
  private readonly socketToSession = new Map<string, AgentSocketSession>();
  private readonly counters = new Map<string, number>();

  private unsubscribeDispatchChannel: (() => Promise<void>) | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private counterLogInterval: NodeJS.Timeout | null = null;
  private socketDisconnect: ((socketId: string) => boolean) | null = null;
  private realtimePingTimeoutSeconds = 45;
  private realtimePingCheckIntervalSeconds = 5;
  private enableRealtimeTaskDispatch = false;
  private socketEmitter:
    | ((socketId: string, event: string, payload: unknown) => boolean)
    | null = null;

  constructor(
    @InjectRepository(AgentTaskLifecycleEventEntity)
    private readonly lifecycleEventsRepository: Repository<AgentTaskLifecycleEventEntity>,
    private readonly nodesService: NodesService,
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => TasksService))
    private readonly tasksService: TasksService,
    private readonly metricsService: MetricsService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.redisService.isEnabled()) {
      return;
    }

    this.unsubscribeDispatchChannel = await this.redisService.subscribe(
      PUBSUB_CHANNELS.AGENT_REALTIME_TASK_DISPATCH,
      (payload) => {
        void this.handleDispatchRouteMessage(payload);
      },
    );

    const agents =
      this.configService.getOrThrow<ConfigType<typeof agentsConfig>>(
        AGENTS_CONFIG_KEY,
      );

    this.realtimePingTimeoutSeconds = Math.max(
      agents.realtimePingTimeoutSeconds,
      15,
    );
    this.realtimePingCheckIntervalSeconds = Math.max(
      agents.realtimePingCheckIntervalSeconds,
      1,
    );
    this.enableRealtimeTaskDispatch = Boolean(
      agents.enableRealtimeTaskDispatch,
    );

    this.logger.log(
      JSON.stringify({
        msg: 'agent-realtime.heartbeat.config',
        realtimePingTimeoutSecondsConfigured: agents.realtimePingTimeoutSeconds,
        realtimePingTimeoutSecondsEffective: this.realtimePingTimeoutSeconds,
        realtimePingCheckIntervalSecondsConfigured:
          agents.realtimePingCheckIntervalSeconds,
        realtimePingCheckIntervalSecondsEffective:
          this.realtimePingCheckIntervalSeconds,
        enableRealtimeTaskDispatch: this.enableRealtimeTaskDispatch,
      }),
    );

    if (this.enableRealtimeTaskDispatch) {
      this.logger.warn(
        JSON.stringify({
          msg: 'agent-realtime.task-dispatch.enabled',
          reason:
            'ENABLE_REALTIME_TASK_DISPATCH=true; realtime task dispatch is deprecated and should be enabled only explicitly',
        }),
      );
    } else {
      this.logger.log(
        JSON.stringify({
          msg: 'agent-realtime.task-dispatch.disabled',
          reason: 'HTTP polling flow is the active task delivery path',
        }),
      );
    }

    this.heartbeatInterval = setInterval(() => {
      void this.enforceHeartbeatTimeouts();
    }, this.realtimePingCheckIntervalSeconds * 1000);

    this.counterLogInterval = setInterval(() => {
      this.logger.log(
        JSON.stringify({
          msg: 'agent-realtime.stats',
          counters: Object.fromEntries(this.counters.entries()),
          claimStats: this.tasksService.getClaimStatsSnapshot(),
          activeConnections: this.nodeToSocketId.size,
        }),
      );
    }, 30000);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.counterLogInterval) {
      clearInterval(this.counterLogInterval);
      this.counterLogInterval = null;
    }

    if (this.unsubscribeDispatchChannel) {
      await this.unsubscribeDispatchChannel();
      this.unsubscribeDispatchChannel = null;
    }
  }

  bindSocketDisconnect(disconnect: (socketId: string) => boolean): void {
    this.socketDisconnect = disconnect;
  }

  bindSocketEmitter(
    emit: (socketId: string, event: string, payload: unknown) => boolean,
  ): void {
    this.socketEmitter = emit;
  }

  incrementCounter(counterName: string, count = 1): void {
    this.counters.set(
      counterName,
      (this.counters.get(counterName) ?? 0) + count,
    );
  }

  getSessionForSocket(socketId: string): AgentSocketSession | null {
    return this.socketToSession.get(socketId) ?? null;
  }

  async authenticateSocket(input: {
    socketId: string;
    nodeId: string;
    agentToken: string;
  }): Promise<{ node: NodeEntity; previousSocketId: string | null }> {
    const node = await this.nodesService.authenticateAgent(
      input.nodeId,
      input.agentToken,
    );

    const previousSocketId = this.nodeToSocketId.get(node.id) ?? null;
    if (previousSocketId && previousSocketId !== input.socketId) {
      this.socketToSession.delete(previousSocketId);
    }

    this.nodeToSocketId.set(node.id, input.socketId);
    this.socketToSession.set(input.socketId, {
      socketId: input.socketId,
      nodeId: node.id,
      agentToken: input.agentToken,
      authenticatedAt: new Date(),
      lastPingAt: new Date(),
    });

    await this.upsertNodeRoute(node.id, input.socketId);

    const { node: onlineNode } = await this.nodesService.markOnline(node.id);
    await this.nodesService.broadcastStatusUpdate(onlineNode);
    this.incrementCounter('auth.success');

    return { node: onlineNode, previousSocketId };
  }

  async registerPing(socketId: string, timestamp?: string): Promise<void> {
    const session = this.socketToSession.get(socketId);
    if (!session) {
      return;
    }

    const receivedAt = new Date();
    session.lastPingAt = receivedAt;

    if (timestamp) {
      const parsedTimestamp = new Date(timestamp);
      if (!Number.isNaN(parsedTimestamp.getTime())) {
        session.lastAgentReportedPingAt = parsedTimestamp;
      }
    }

    await this.upsertNodeRoute(session.nodeId, session.socketId);
    this.incrementCounter('ping.received');
  }

  async ingestRealtimeMetrics(
    socketId: string,
    payload: Omit<AgentMetricsDto, 'nodeId' | 'agentToken'>,
  ): Promise<void> {
    const session = this.socketToSession.get(socketId);
    if (!session) {
      return;
    }

    await this.metricsService.ingest({
      ...payload,
      nodeId: session.nodeId,
      agentToken: session.agentToken,
    });

    this.incrementCounter('metrics.ingested');
  }

  async dispatchQueuedTasks(nodeId: string): Promise<number> {
    if (!this.enableRealtimeTaskDispatch) {
      return 0;
    }

    const tasks = await this.tasksService.findQueuedForNode(nodeId, 50);
    let dispatched = 0;
    for (const task of tasks) {
      const sent = await this.dispatchTaskToNode(task);
      if (sent) {
        dispatched += 1;
      }
    }

    return dispatched;
  }

  async registerLifecycleEvent(input: {
    nodeId: string;
    taskId: string;
    eventType: string;
    eventTimestamp?: string;
    payload: Record<string, unknown>;
  }): Promise<boolean> {
    const eventTimestamp = input.eventTimestamp
      ? new Date(input.eventTimestamp)
      : new Date();

    const event = this.lifecycleEventsRepository.create({
      nodeId: input.nodeId,
      taskId: input.taskId,
      eventType: input.eventType,
      eventTimestamp,
      payload: input.payload,
    });

    try {
      await this.lifecycleEventsRepository.save(event);
      return true;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === '23505') {
        this.incrementCounter('events.duplicate');
        return false;
      }

      throw error;
    }
  }

  async handleSocketDisconnect(socketId: string): Promise<void> {
    const session = this.socketToSession.get(socketId);
    if (!session) {
      return;
    }

    this.socketToSession.delete(socketId);
    const currentSocketId = this.nodeToSocketId.get(session.nodeId);

    // Ignore stale disconnects after a successful reconnect replaced this socket.
    if (currentSocketId !== socketId) {
      return;
    }

    this.nodeToSocketId.delete(session.nodeId);
    await this.clearNodeRouteIfOwned(session.nodeId, socketId);

    const { node: offlineNode } = await this.nodesService.markOffline(
      session.nodeId,
    );
    if (offlineNode.status === NodeStatus.OFFLINE) {
      await this.nodesService.broadcastStatusUpdate(offlineNode);
    }

    this.incrementCounter('disconnect.total');
  }

  async dispatchTaskToNode(task: TaskEntity): Promise<boolean> {
    if (!this.enableRealtimeTaskDispatch) {
      return false;
    }

    const localSocketId = this.nodeToSocketId.get(task.nodeId);
    if (localSocketId && this.emitTaskDispatch(localSocketId, task)) {
      this.incrementCounter('dispatch.local.success');
      return true;
    }

    const route = await this.getNodeRoute(task.nodeId);
    if (!route || route.instanceId === this.instanceId) {
      return false;
    }

    await this.redisService.publish(
      PUBSUB_CHANNELS.AGENT_REALTIME_TASK_DISPATCH,
      {
        targetInstanceId: route.instanceId,
        nodeId: task.nodeId,
        task: this.buildTaskDispatchPayload(task),
      },
    );

    this.incrementCounter('dispatch.routed');

    return true;
  }

  private emitTaskDispatch(socketId: string, task: TaskEntity): boolean {
    if (!this.socketEmitter) {
      return false;
    }

    return this.socketEmitter(
      socketId,
      AGENT_REALTIME_SERVER_EVENTS.TASK_DISPATCH,
      this.buildTaskDispatchPayload(task),
    );
  }

  private buildTaskDispatchPayload(task: TaskEntity): AgentTaskDispatchPayload {
    const timeoutCandidate = task.payload?.timeoutSeconds;
    const timeoutSeconds =
      typeof timeoutCandidate === 'number' && timeoutCandidate > 0
        ? Math.floor(timeoutCandidate)
        : 60;

    return {
      type: AGENT_REALTIME_SERVER_EVENTS.TASK_DISPATCH,
      task: {
        id: task.id,
        type: task.type,
        payload: task.payload,
        timeoutSeconds,
      },
    };
  }

  private async handleDispatchRouteMessage(
    payload: Record<string, unknown>,
  ): Promise<void> {
    const message = payload as AgentTaskDispatchRouteMessage;
    if (message.targetInstanceId !== this.instanceId || !message.nodeId) {
      return;
    }

    const socketId = this.nodeToSocketId.get(message.nodeId);
    if (!socketId || !this.socketEmitter) {
      return;
    }

    const delivered = this.socketEmitter(
      socketId,
      AGENT_REALTIME_SERVER_EVENTS.TASK_DISPATCH,
      message.task,
    );

    if (!delivered) {
      this.incrementCounter('dispatch.routed.failed');
      this.logger.warn(
        `Task dispatch routing failed for node ${message.nodeId} on ${this.instanceId}`,
      );
    }
  }

  private async enforceHeartbeatTimeouts(): Promise<void> {
    const timeoutMs = this.realtimePingTimeoutSeconds * 1000;
    const now = Date.now();

    for (const session of this.socketToSession.values()) {
      const lastPingAtMs = session.lastPingAt.getTime();
      const ageMs = now - lastPingAtMs;
      if (ageMs <= timeoutMs) {
        continue;
      }

      this.incrementCounter('ping.timeout');
      this.logger.warn(
        JSON.stringify({
          msg: 'agent-realtime.heartbeat.timeout',
          reason: 'ping-timeout',
          socketId: session.socketId,
          nodeId: session.nodeId,
          realtimePingTimeoutSeconds: this.realtimePingTimeoutSeconds,
          realtimePingCheckIntervalSeconds:
            this.realtimePingCheckIntervalSeconds,
          lastPingAt: session.lastPingAt.toISOString(),
          lastAgentReportedPingAt:
            session.lastAgentReportedPingAt?.toISOString() ?? null,
          ageMs,
          timeoutMs,
        }),
      );

      const disconnected = this.socketDisconnect?.(session.socketId) ?? false;
      if (!disconnected) {
        this.logger.warn(
          JSON.stringify({
            msg: 'agent-realtime.heartbeat.timeout.disconnect-fallback',
            reason: 'socket-disconnect-handler-unavailable',
            socketId: session.socketId,
            nodeId: session.nodeId,
          }),
        );
        await this.handleSocketDisconnect(session.socketId);
      }
    }
  }

  private buildNodeRouteKey(nodeId: string): string {
    return `${AGENT_REALTIME_REDIS_KEYS.NODE_ROUTE_PREFIX}${nodeId}`;
  }

  private async upsertNodeRoute(
    nodeId: string,
    socketId: string,
  ): Promise<void> {
    const route: AgentNodeRoute = {
      instanceId: this.instanceId,
      socketId,
      nodeId,
      updatedAt: new Date().toISOString(),
    };

    await this.redisService.set(
      this.buildNodeRouteKey(nodeId),
      route,
      AGENT_REALTIME_ROUTE_TTL_SECONDS,
    );
  }

  private async getNodeRoute(nodeId: string): Promise<AgentNodeRoute | null> {
    const payload = await this.redisService.get(this.buildNodeRouteKey(nodeId));
    if (!payload) {
      return null;
    }

    try {
      return JSON.parse(payload) as AgentNodeRoute;
    } catch {
      return null;
    }
  }

  private async clearNodeRouteIfOwned(
    nodeId: string,
    socketId: string,
  ): Promise<void> {
    const route = await this.getNodeRoute(nodeId);
    if (!route) {
      return;
    }

    if (route.instanceId !== this.instanceId || route.socketId !== socketId) {
      return;
    }

    await this.redisService.del(this.buildNodeRouteKey(nodeId));
  }
}
