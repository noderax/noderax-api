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
import { AgentUpdatesService } from '../agent-updates/agent-updates.service';
import { MetricsService } from '../metrics/metrics.service';
import { NodeEntity } from '../nodes/entities/node.entity';
import { NodeRootAccessProfile } from '../nodes/entities/node-root-access-profile.enum';
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

type RoutedAgentEventMessage = {
  targetInstanceId: string;
  nodeId: string;
  event: string;
  payload: Record<string, unknown>;
};

@Injectable()
export class AgentRealtimeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AgentRealtimeService.name);
  private readonly instanceId = `${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;

  private readonly nodeToSocketId = new Map<string, string>();
  private readonly socketToSession = new Map<string, AgentSocketSession>();
  private readonly counters = new Map<string, number>();

  private readonly unsubscribeDispatchChannels: Array<() => Promise<void>> = [];
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
    @Inject(forwardRef(() => AgentUpdatesService))
    private readonly agentUpdatesService: AgentUpdatesService,
  ) {}

  async onModuleInit(): Promise<void> {
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

    if (!this.redisService.isEnabled()) {
      return;
    }

    this.unsubscribeDispatchChannels.push(
      await this.redisService.subscribe(
        PUBSUB_CHANNELS.AGENT_REALTIME_TASK_DISPATCH,
        (payload) => {
          void this.handleRoutedEventMessage(payload);
        },
      ),
      await this.redisService.subscribe(
        PUBSUB_CHANNELS.AGENT_REALTIME_TERMINAL_CONTROL,
        (payload) => {
          void this.handleRoutedEventMessage(payload);
        },
      ),
    );

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

    for (const unsubscribe of this.unsubscribeDispatchChannels) {
      await unsubscribe();
    }
    this.unsubscribeDispatchChannels.length = 0;
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

  getCountersSnapshot(): Record<string, number> {
    return Object.fromEntries(this.counters.entries());
  }

  getRealtimeHealthSnapshot(): {
    realtimeConnected: boolean;
    lastAgentSeenAt: string | null;
  } {
    let latestSeen: Date | null = null;

    for (const session of this.socketToSession.values()) {
      if (!latestSeen || session.lastPingAt.getTime() > latestSeen.getTime()) {
        latestSeen = session.lastPingAt;
      }
    }

    return {
      realtimeConnected: this.nodeToSocketId.size > 0,
      lastAgentSeenAt: latestSeen ? latestSeen.toISOString() : null,
    };
  }

  getSessionForSocket(socketId: string): AgentSocketSession | null {
    return this.socketToSession.get(socketId) ?? null;
  }

  async authenticateSocket(input: {
    socketId: string;
    nodeId: string;
    agentToken: string;
    agentVersion?: string;
    platformVersion?: string;
    kernelVersion?: string;
    rootAccess?: {
      appliedProfile?: NodeRootAccessProfile | null;
      lastAppliedAt?: string | null;
      lastError?: string | null;
    };
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

    const { node: onlineNode } = await this.nodesService.markOnline(node.id, {
      agentVersion: input.agentVersion ?? null,
      platformVersion: input.platformVersion ?? null,
      kernelVersion: input.kernelVersion ?? null,
    });
    const rootedNode =
      (await this.nodesService.recordAgentRootAccessState(
        node.id,
        input.rootAccess,
      )) ?? onlineNode;
    await this.nodesService.broadcastStatusUpdate(rootedNode);
    await this.agentUpdatesService.observeNodeVersion({
      id: rootedNode.id,
      agentVersion: rootedNode.agentVersion,
    });
    this.incrementCounter('auth.success');

    return { node: rootedNode, previousSocketId };
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

    if (payload.agentVersion) {
      const { node } = await this.nodesService.markOnline(session.nodeId, {
        agentVersion: payload.agentVersion,
      });
      await this.agentUpdatesService.observeNodeVersion({
        id: node.id,
        agentVersion: node.agentVersion,
      });
    }

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

    const payload = this.buildTaskDispatchPayload(task);
    const delivered = await this.emitEventToNode(
      task.nodeId,
      AGENT_REALTIME_SERVER_EVENTS.TASK_DISPATCH,
      payload,
    );
    return delivered;
  }

  async startTerminalSession(
    nodeId: string,
    payload: {
      sessionId: string;
      cols: number;
      rows: number;
      runAsRoot?: boolean;
    },
  ): Promise<boolean> {
    return this.emitEventToNode(
      nodeId,
      AGENT_REALTIME_SERVER_EVENTS.TERMINAL_START,
      {
        type: AGENT_REALTIME_SERVER_EVENTS.TERMINAL_START,
        sessionId: payload.sessionId,
        cols: payload.cols,
        rows: payload.rows,
        runAsRoot: payload.runAsRoot === true,
      },
    );
  }

  async sendTerminalInput(
    nodeId: string,
    payload: {
      sessionId: string;
      payload: string;
    },
  ): Promise<boolean> {
    return this.emitEventToNode(
      nodeId,
      AGENT_REALTIME_SERVER_EVENTS.TERMINAL_INPUT,
      {
        type: AGENT_REALTIME_SERVER_EVENTS.TERMINAL_INPUT,
        sessionId: payload.sessionId,
        payload: payload.payload,
      },
    );
  }

  async resizeTerminalSession(
    nodeId: string,
    payload: {
      sessionId: string;
      cols: number;
      rows: number;
    },
  ): Promise<boolean> {
    return this.emitEventToNode(
      nodeId,
      AGENT_REALTIME_SERVER_EVENTS.TERMINAL_RESIZE,
      {
        type: AGENT_REALTIME_SERVER_EVENTS.TERMINAL_RESIZE,
        sessionId: payload.sessionId,
        cols: payload.cols,
        rows: payload.rows,
      },
    );
  }

  async stopTerminalSession(
    nodeId: string,
    payload: {
      sessionId: string;
      reason?: string | null;
    },
  ): Promise<boolean> {
    return this.emitEventToNode(
      nodeId,
      AGENT_REALTIME_SERVER_EVENTS.TERMINAL_STOP,
      {
        type: AGENT_REALTIME_SERVER_EVENTS.TERMINAL_STOP,
        sessionId: payload.sessionId,
        reason: payload.reason ?? null,
      },
    );
  }

  async hasActiveNodeRoute(nodeId: string): Promise<boolean> {
    const localSocketId = this.nodeToSocketId.get(nodeId);
    if (localSocketId) {
      return true;
    }

    const route = await this.getNodeRoute(nodeId);
    return Boolean(route);
  }

  private emitRawEvent(
    socketId: string,
    event: string,
    payload: Record<string, unknown>,
  ): boolean {
    if (!this.socketEmitter) {
      return false;
    }

    return this.socketEmitter(socketId, event, payload);
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

  private async emitEventToNode(
    nodeId: string,
    event: string,
    payload: Record<string, unknown>,
  ): Promise<boolean> {
    const localSocketId = this.nodeToSocketId.get(nodeId);
    if (localSocketId && this.emitRawEvent(localSocketId, event, payload)) {
      this.incrementCounter(
        event === AGENT_REALTIME_SERVER_EVENTS.TASK_DISPATCH
          ? 'dispatch.local.success'
          : 'terminal.local.success',
      );
      return true;
    }

    const route = await this.getNodeRoute(nodeId);
    if (!route || route.instanceId === this.instanceId) {
      return false;
    }

    await this.redisService.publish(
      event === AGENT_REALTIME_SERVER_EVENTS.TASK_DISPATCH
        ? PUBSUB_CHANNELS.AGENT_REALTIME_TASK_DISPATCH
        : PUBSUB_CHANNELS.AGENT_REALTIME_TERMINAL_CONTROL,
      {
        targetInstanceId: route.instanceId,
        nodeId,
        event,
        payload,
      },
    );

    this.incrementCounter(
      event === AGENT_REALTIME_SERVER_EVENTS.TASK_DISPATCH
        ? 'dispatch.routed'
        : 'terminal.routed',
    );
    return true;
  }

  private async handleRoutedEventMessage(
    payload: Record<string, unknown>,
  ): Promise<void> {
    const message = payload as RoutedAgentEventMessage;
    if (message.targetInstanceId !== this.instanceId || !message.nodeId) {
      return;
    }

    const socketId = this.nodeToSocketId.get(message.nodeId);
    if (!socketId || !this.socketEmitter) {
      return;
    }

    const delivered = this.socketEmitter(
      socketId,
      message.event,
      message.payload,
    );

    if (!delivered) {
      this.incrementCounter(
        message.event === AGENT_REALTIME_SERVER_EVENTS.TASK_DISPATCH
          ? 'dispatch.routed.failed'
          : 'terminal.routed.failed',
      );
      this.logger.warn(
        `Realtime routing failed for node ${message.nodeId} on ${this.instanceId} event=${message.event}`,
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
