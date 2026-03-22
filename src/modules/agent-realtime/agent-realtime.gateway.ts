import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { HttpException, Logger, ValidationPipe } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import {
  AGENT_REALTIME_SLOW_CLIENT_BUFFER_LIMIT,
  AGENT_REALTIME_CLIENT_EVENTS,
  AGENT_REALTIME_NAMESPACE,
  AGENT_REALTIME_SERVER_EVENTS,
} from '../../common/constants/agent-realtime.constants';
import { Server, Socket } from 'socket.io';
import { AppendTaskLogDto } from '../tasks/dto/append-task-log.dto';
import { CompleteAgentTaskDto } from '../tasks/dto/complete-agent-task.dto';
import { StartAgentTaskDto } from '../tasks/dto/start-agent-task.dto';
import { TasksService } from '../tasks/tasks.service';
import { AgentMetricsMessageDto } from './dto/agent-metrics-message.dto';
import { AgentAuthMessageDto } from './dto/agent-auth-message.dto';
import { AgentPingMessageDto } from './dto/agent-ping-message.dto';
import { AgentTaskAcceptedMessageDto } from './dto/agent-task-accepted-message.dto';
import { AgentTaskCompletedMessageDto } from './dto/agent-task-completed-message.dto';
import { AgentTaskLogMessageDto } from './dto/agent-task-log-message.dto';
import { AgentTaskStartedMessageDto } from './dto/agent-task-started-message.dto';
import { AgentRealtimeService } from './agent-realtime.service';
import { TASK_OUTPUT_MAX_LENGTH } from '../tasks/dto/complete-agent-task.dto';

@Public()
@WebSocketGateway({
  namespace: AGENT_REALTIME_NAMESPACE,
  transports: ['websocket'],
  allowUpgrades: false,
  cors: {
    origin: '*',
    credentials: true,
  },
})
export class AgentRealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(AgentRealtimeGateway.name);
  private readonly validationPipe = new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  });

  constructor(
    private readonly tasksService: TasksService,
    private readonly agentRealtimeService: AgentRealtimeService,
  ) {}

  afterInit(): void {
    this.agentRealtimeService.bindSocketEmitter((socketId, event, payload) => {
      const socket = this.getSocketById(socketId);
      if (!socket) {
        return false;
      }

      const pendingWrites = (
        socket.conn as unknown as { writeBuffer?: unknown[] }
      ).writeBuffer?.length;
      if (
        typeof pendingWrites === 'number' &&
        pendingWrites >= AGENT_REALTIME_SLOW_CLIENT_BUFFER_LIMIT
      ) {
        this.agentRealtimeService.incrementCounter(
          'dispatch.backpressure.drop',
        );
        this.logger.warn(
          `Skipped emit to slow socket ${socket.id}; writeBuffer=${pendingWrites}`,
        );
        return false;
      }

      socket.emit(event, payload);
      return true;
    });

    this.agentRealtimeService.bindSocketDisconnect((socketId) => {
      const socket = this.getSocketById(socketId);
      if (!socket) {
        return false;
      }

      this.disconnectWithReason(socket, 'heartbeat-timeout');
      return true;
    });
  }

  handleConnection(client: Socket): void {
    this.logger.log(
      JSON.stringify({
        msg: 'agent-realtime.connected',
        socketId: client.id,
        namespace: AGENT_REALTIME_NAMESPACE,
        transport: client.conn.transport.name,
      }),
    );
    this.agentRealtimeService.incrementCounter('connection.opened');

    client.on('disconnect', (reason) => {
      this.logger.log(
        JSON.stringify({
          msg: 'agent-realtime.disconnected',
          socketId: client.id,
          namespace: AGENT_REALTIME_NAMESPACE,
          transport: client.conn.transport.name,
          reason,
        }),
      );
    });

    client.onAny((eventName: string) => {
      const allowedEvents = new Set<string>([
        AGENT_REALTIME_CLIENT_EVENTS.AUTH,
        AGENT_REALTIME_CLIENT_EVENTS.PING,
        AGENT_REALTIME_CLIENT_EVENTS.TASK_ACCEPTED,
        AGENT_REALTIME_CLIENT_EVENTS.TASK_STARTED,
        AGENT_REALTIME_CLIENT_EVENTS.TASK_LOG,
        AGENT_REALTIME_CLIENT_EVENTS.TASK_COMPLETED,
        AGENT_REALTIME_CLIENT_EVENTS.METRICS,
      ]);

      if (allowedEvents.has(eventName)) {
        return;
      }

      this.agentRealtimeService.incrementCounter('event.rejected.unknown');
      client.emit(AGENT_REALTIME_SERVER_EVENTS.ERROR, {
        type: AGENT_REALTIME_SERVER_EVENTS.ERROR,
        code: 'UNKNOWN_EVENT',
        message: `Unsupported event: ${eventName}`,
      });
    });
  }

  async handleDisconnect(client: Socket): Promise<void> {
    await this.agentRealtimeService.handleSocketDisconnect(client.id);
    this.logger.debug(`Agent socket disconnected: ${client.id}`);
  }

  @SubscribeMessage(AGENT_REALTIME_CLIENT_EVENTS.AUTH)
  async handleAgentAuth(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: AgentAuthMessageDto,
  ) {
    try {
      const body = await this.validationPipe.transform(payload, {
        type: 'body',
        metatype: AgentAuthMessageDto,
      });

      const { node, previousSocketId } =
        await this.agentRealtimeService.authenticateSocket({
          socketId: client.id,
          nodeId: body.nodeId,
          agentToken: body.agentToken,
        });

      if (previousSocketId && previousSocketId !== client.id) {
        const previousSocket = this.getSocketById(previousSocketId);
        if (previousSocket) {
          this.disconnectWithReason(
            previousSocket,
            'socket-replaced-after-auth-reconnect',
          );
        }
      }

      client.emit(AGENT_REALTIME_SERVER_EVENTS.AUTH_ACK, {
        type: AGENT_REALTIME_SERVER_EVENTS.AUTH_ACK,
        authenticated: true,
        nodeId: node.id,
      });

      await this.agentRealtimeService.dispatchQueuedTasks(node.id);

      return {
        type: AGENT_REALTIME_SERVER_EVENTS.AUTH_ACK,
        authenticated: true,
        nodeId: node.id,
      };
    } catch (error) {
      this.agentRealtimeService.incrementCounter('auth.failed');
      const message = this.getSafeErrorMessage(error, 'Invalid auth');
      client.emit(AGENT_REALTIME_SERVER_EVENTS.AUTH_ERROR, {
        type: AGENT_REALTIME_SERVER_EVENTS.AUTH_ERROR,
        authenticated: false,
        message,
      });
      this.disconnectWithReason(client, 'auth-failed');
      return {
        authenticated: false,
        message,
      };
    }
  }

  @SubscribeMessage(AGENT_REALTIME_CLIENT_EVENTS.PING)
  async handleAgentPing(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: AgentPingMessageDto,
  ) {
    const session = this.agentRealtimeService.getSessionForSocket(client.id);
    if (!session) {
      this.disconnectWithReason(client, 'ping-before-auth');
      return { ok: false, message: 'Socket is not authenticated' };
    }

    try {
      const body = await this.validationPipe.transform(payload, {
        type: 'body',
        metatype: AgentPingMessageDto,
      });

      await this.agentRealtimeService.registerPing(client.id, body.timestamp);
      await this.agentRealtimeService.dispatchQueuedTasks(session.nodeId);

      return {
        ok: true,
        type: AGENT_REALTIME_CLIENT_EVENTS.PING,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return this.emitHandlerError(
        client,
        AGENT_REALTIME_CLIENT_EVENTS.PING,
        error,
      );
    }
  }

  @SubscribeMessage(AGENT_REALTIME_CLIENT_EVENTS.TASK_ACCEPTED)
  async handleTaskAccepted(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: AgentTaskAcceptedMessageDto,
  ) {
    const session = this.agentRealtimeService.getSessionForSocket(client.id);
    if (!session) {
      this.disconnectWithReason(client, 'task.accepted-before-auth');
      return { ok: false, message: 'Socket is not authenticated' };
    }

    try {
      const body = await this.validationPipe.transform(payload, {
        type: 'body',
        metatype: AgentTaskAcceptedMessageDto,
      });

      const isNewEvent = await this.agentRealtimeService.registerLifecycleEvent(
        {
          nodeId: session.nodeId,
          taskId: body.taskId,
          eventType: AGENT_REALTIME_CLIENT_EVENTS.TASK_ACCEPTED,
          eventTimestamp: body.timestamp,
          payload: body as unknown as Record<string, unknown>,
        },
      );

      if (!isNewEvent) {
        return { ok: true, duplicate: true, taskId: body.taskId };
      }

      await this.tasksService.acknowledgeForAgent(body.taskId, {
        nodeId: session.nodeId,
        agentToken: session.agentToken,
        timestamp: body.timestamp,
      });

      return {
        ok: true,
        taskId: body.taskId,
      };
    } catch (error) {
      return this.emitLifecycleValidationError(
        client,
        AGENT_REALTIME_CLIENT_EVENTS.TASK_ACCEPTED,
        payload,
        error,
      );
    }
  }

  @SubscribeMessage(AGENT_REALTIME_CLIENT_EVENTS.TASK_STARTED)
  async handleTaskStarted(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: AgentTaskStartedMessageDto,
  ) {
    const session = this.agentRealtimeService.getSessionForSocket(client.id);
    if (!session) {
      this.disconnectWithReason(client, 'task.started-before-auth');
      return { ok: false, message: 'Socket is not authenticated' };
    }

    try {
      const body = await this.validationPipe.transform(payload, {
        type: 'body',
        metatype: AgentTaskStartedMessageDto,
      });

      const isNewEvent = await this.agentRealtimeService.registerLifecycleEvent(
        {
          nodeId: session.nodeId,
          taskId: body.taskId,
          eventType: AGENT_REALTIME_CLIENT_EVENTS.TASK_STARTED,
          eventTimestamp: body.timestamp,
          payload: body as unknown as Record<string, unknown>,
        },
      );

      if (!isNewEvent) {
        return { ok: true, duplicate: true, taskId: body.taskId };
      }

      const dto: StartAgentTaskDto = {
        nodeId: session.nodeId,
        agentToken: session.agentToken,
        taskId: body.taskId,
        startedAt: body.timestamp,
      };

      const task = await this.tasksService.startForAgent(body.taskId, dto);

      return {
        ok: true,
        taskId: task.id,
        status: task.status,
      };
    } catch (error) {
      return this.emitLifecycleValidationError(
        client,
        AGENT_REALTIME_CLIENT_EVENTS.TASK_STARTED,
        payload,
        error,
      );
    }
  }

  @SubscribeMessage(AGENT_REALTIME_CLIENT_EVENTS.TASK_LOG)
  async handleTaskLog(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: AgentTaskLogMessageDto,
  ) {
    const session = this.agentRealtimeService.getSessionForSocket(client.id);
    if (!session) {
      this.disconnectWithReason(client, 'task.log-before-auth');
      return { ok: false, message: 'Socket is not authenticated' };
    }

    try {
      const body = await this.validationPipe.transform(payload, {
        type: 'body',
        metatype: AgentTaskLogMessageDto,
      });

      const isNewEvent = await this.agentRealtimeService.registerLifecycleEvent(
        {
          nodeId: session.nodeId,
          taskId: body.taskId,
          eventType: AGENT_REALTIME_CLIENT_EVENTS.TASK_LOG,
          eventTimestamp: body.timestamp,
          payload: body as unknown as Record<string, unknown>,
        },
      );

      if (!isNewEvent) {
        return { ok: true, duplicate: true, taskId: body.taskId };
      }

      const dto: AppendTaskLogDto = {
        nodeId: session.nodeId,
        agentToken: session.agentToken,
        taskId: body.taskId,
        entries: [
          {
            stream: body.stream,
            line: body.line,
            timestamp: body.timestamp,
          },
        ],
      };

      await this.tasksService.appendLogForAgent(body.taskId, dto);

      return {
        ok: true,
        taskId: body.taskId,
      };
    } catch (error) {
      return this.emitLifecycleValidationError(
        client,
        AGENT_REALTIME_CLIENT_EVENTS.TASK_LOG,
        payload,
        error,
      );
    }
  }

  @SubscribeMessage(AGENT_REALTIME_CLIENT_EVENTS.TASK_COMPLETED)
  async handleTaskCompleted(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: AgentTaskCompletedMessageDto,
  ) {
    const session = this.agentRealtimeService.getSessionForSocket(client.id);
    if (!session) {
      this.disconnectWithReason(client, 'task.completed-before-auth');
      return { ok: false, message: 'Socket is not authenticated' };
    }

    try {
      const body = await this.validationPipe.transform(payload, {
        type: 'body',
        metatype: AgentTaskCompletedMessageDto,
      });

      const isNewEvent = await this.agentRealtimeService.registerLifecycleEvent(
        {
          nodeId: session.nodeId,
          taskId: body.taskId,
          eventType: AGENT_REALTIME_CLIENT_EVENTS.TASK_COMPLETED,
          eventTimestamp: body.timestamp,
          payload: body as unknown as Record<string, unknown>,
        },
      );

      if (!isNewEvent) {
        return { ok: true, duplicate: true, taskId: body.taskId };
      }

      const dto: CompleteAgentTaskDto = {
        nodeId: session.nodeId,
        agentToken: session.agentToken,
        taskId: body.taskId,
        status: body.status,
        result: body.result,
        output: body.output,
        exitCode: body.exitCode,
        error: body.error,
        completedAt: body.timestamp,
        durationMs: body.durationMs,
      };

      const task = await this.tasksService.completeForAgent(body.taskId, dto);

      return {
        ok: true,
        taskId: task.id,
        status: task.status,
      };
    } catch (error) {
      return this.emitLifecycleValidationError(
        client,
        AGENT_REALTIME_CLIENT_EVENTS.TASK_COMPLETED,
        payload,
        error,
      );
    }
  }

  @SubscribeMessage(AGENT_REALTIME_CLIENT_EVENTS.METRICS)
  async handleAgentMetrics(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: AgentMetricsMessageDto,
  ) {
    const session = this.agentRealtimeService.getSessionForSocket(client.id);
    if (!session) {
      this.disconnectWithReason(client, 'metrics-before-auth');
      return { ok: false, message: 'Socket is not authenticated' };
    }

    const rawPayload = this.asRecord(payload);
    const normalizedPayload = this.normalizeRealtimeMetricsPayload(rawPayload);

    this.logger.debug(
      JSON.stringify({
        msg: 'agent-realtime.metrics.received',
        socketId: client.id,
        namespace: AGENT_REALTIME_NAMESPACE,
        payloadKeys: Object.keys(rawPayload),
        hasNetworkStats: Object.prototype.hasOwnProperty.call(
          rawPayload,
          'networkStats',
        ),
        hasNetworks: Object.prototype.hasOwnProperty.call(
          rawPayload,
          'networks',
        ),
        normalized: normalizedPayload.normalized,
        normalizationReasons: normalizedPayload.reasons,
      }),
    );

    try {
      const body = await this.validationPipe.transform(
        normalizedPayload.value,
        {
          type: 'body',
          metatype: AgentMetricsMessageDto,
        },
      );

      await this.agentRealtimeService.ingestRealtimeMetrics(client.id, {
        ...body,
        nodeId: session.nodeId,
        agentToken: session.agentToken,
        collectedAt: body.timestamp ?? body.collectedAt,
      });
      await this.agentRealtimeService.registerPing(client.id, body.timestamp);

      return {
        ok: true,
        type: AGENT_REALTIME_CLIENT_EVENTS.METRICS,
        nodeId: session.nodeId,
      };
    } catch (error) {
      await this.agentRealtimeService.registerPing(client.id);
      this.logger.warn(
        JSON.stringify({
          msg: 'agent-realtime.metrics.validation-failed',
          socketId: client.id,
          namespace: AGENT_REALTIME_NAMESPACE,
          reason: this.getSafeErrorMessage(error, 'Invalid payload'),
          socketKeptOpen: true,
        }),
      );

      return this.emitHandlerError(
        client,
        AGENT_REALTIME_CLIENT_EVENTS.METRICS,
        error,
      );
    }
  }

  private emitHandlerError(client: Socket, eventType: string, error: unknown) {
    this.agentRealtimeService.incrementCounter('event.rejected.invalid');
    const message = this.getSafeErrorMessage(error, 'Invalid payload');
    client.emit(AGENT_REALTIME_SERVER_EVENTS.ERROR, {
      type: AGENT_REALTIME_SERVER_EVENTS.ERROR,
      eventType,
      message,
    });

    return {
      ok: false,
      eventType,
      message,
    };
  }

  private emitLifecycleValidationError(
    client: Socket,
    eventType: string,
    payload: unknown,
    error: unknown,
  ) {
    const payloadRecord = this.asRecord(payload);
    const payloadKeys = Object.keys(payloadRecord);
    const validationMessages = this.extractValidationMessages(error);
    const reason = this.getValidationErrorMessage(error, 'Invalid payload');
    const rejectedPayloadKeys = this.extractRejectedPayloadKeys(
      payloadRecord,
      validationMessages,
    );
    const outputLength =
      typeof payloadRecord.output === 'string'
        ? payloadRecord.output.length
        : 0;

    this.logger.warn(
      JSON.stringify({
        msg: 'agent-realtime.lifecycle.validation-failed',
        eventType,
        socketId: client.id,
        namespace: AGENT_REALTIME_NAMESPACE,
        payloadKeys,
        rejectedPayloadKeys,
        validationMessages,
        outputLength: outputLength > 0 ? outputLength : undefined,
        outputMaxLength:
          eventType === AGENT_REALTIME_CLIENT_EVENTS.TASK_COMPLETED
            ? TASK_OUTPUT_MAX_LENGTH
            : undefined,
        reason,
        socketStillConnected: client.connected,
      }),
    );

    return this.emitHandlerError(client, eventType, error);
  }

  private getSocketById(socketId: string): Socket | null {
    const sockets = this.getAgentSockets();
    if (!sockets) {
      return null;
    }

    const socket = sockets.get(socketId);
    return socket ?? null;
  }

  private getAgentSockets(): Map<string, Socket> | null {
    const serverLike = this.server as unknown as {
      sockets?: Map<string, Socket>;
      of?: (namespace: string) => { sockets?: Map<string, Socket> };
    };

    // In a namespaced gateway, Nest can provide a namespace-like object directly.
    if (serverLike?.sockets instanceof Map) {
      return serverLike.sockets;
    }

    const namespaceSockets = serverLike?.of?.(
      AGENT_REALTIME_NAMESPACE,
    )?.sockets;
    if (namespaceSockets instanceof Map) {
      return namespaceSockets;
    }

    if (!this.server) {
      this.logger.warn(
        `Socket namespace unavailable for ${AGENT_REALTIME_NAMESPACE}`,
      );
    }

    return null;
  }

  private getSafeErrorMessage(error: unknown, fallback: string): string {
    if (!(error instanceof Error)) {
      return fallback;
    }

    const message = error.message?.trim();
    if (!message) {
      return fallback;
    }

    if (/cannot read properties of undefined/i.test(message)) {
      return fallback;
    }

    return message.slice(0, 300);
  }

  private getValidationErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof HttpException) {
      const response = error.getResponse();
      if (typeof response === 'object' && response) {
        const message = (response as Record<string, unknown>).message;
        if (Array.isArray(message)) {
          const normalized = message
            .map((entry) =>
              typeof entry === 'string' ? entry.trim() : String(entry),
            )
            .filter((entry) => entry.length > 0);
          if (normalized.length > 0) {
            return normalized.join('; ').slice(0, 600);
          }
        }

        if (typeof message === 'string' && message.trim().length > 0) {
          return message.trim().slice(0, 600);
        }
      }
    }

    return this.getSafeErrorMessage(error, fallback);
  }

  private extractValidationMessages(error: unknown): string[] {
    if (!(error instanceof HttpException)) {
      return [];
    }

    const response = error.getResponse();
    if (!response || typeof response !== 'object') {
      return [];
    }

    const message = (response as Record<string, unknown>).message;
    if (Array.isArray(message)) {
      return message
        .map((entry) =>
          typeof entry === 'string' ? entry.trim() : String(entry),
        )
        .filter((entry) => entry.length > 0)
        .slice(0, 20);
    }

    if (typeof message === 'string' && message.trim().length > 0) {
      return [message.trim()];
    }

    return [];
  }

  private extractRejectedPayloadKeys(
    payload: Record<string, unknown>,
    validationMessages: string[],
  ): string[] {
    const rejected = new Set<string>();

    for (const message of validationMessages) {
      const nonWhitelistedMatch = message.match(
        /^property\s+([^\s]+)\s+should not exist$/i,
      );
      if (nonWhitelistedMatch?.[1]) {
        rejected.add(nonWhitelistedMatch[1]);
      }
    }

    for (const key of rejected) {
      if (!(key in payload)) {
        rejected.delete(key);
      }
    }

    return Array.from(rejected.values()).sort((a, b) => a.localeCompare(b));
  }

  private asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    return { ...(value as Record<string, unknown>) };
  }

  private disconnectWithReason(client: Socket, reason: string): void {
    this.logger.warn(
      JSON.stringify({
        msg: 'agent-realtime.server-forced-disconnect',
        socketId: client.id,
        namespace: AGENT_REALTIME_NAMESPACE,
        reason,
        socketConnectedBeforeDisconnect: client.connected,
      }),
    );

    client.disconnect(true);
  }

  private normalizeRealtimeMetricsPayload(payload: Record<string, unknown>): {
    value: Record<string, unknown>;
    normalized: boolean;
    reasons: string[];
  } {
    const value = { ...payload };
    const reasons: string[] = [];

    if (value.networkStats === null) {
      delete value.networkStats;
      reasons.push('networkStats:null->omitted');
    }

    if (Array.isArray(value.networkStats)) {
      if (!Array.isArray(value.networks)) {
        value.networks = value.networkStats;
      }
      delete value.networkStats;
      reasons.push('networkStats:array->networks');
    }

    if (value.networks === null) {
      value.networks = [];
      reasons.push('networks:null->[]');
    }

    if (value.networkStats === undefined && value.networks === undefined) {
      value.networks = [];
      reasons.push('missing-network-fields->networks:[]');
    }

    return {
      value,
      normalized: reasons.length > 0,
      reasons,
    };
  }
}
