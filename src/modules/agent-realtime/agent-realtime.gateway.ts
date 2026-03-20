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
import { Logger, ValidationPipe } from '@nestjs/common';
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

@Public()
@WebSocketGateway({
  namespace: AGENT_REALTIME_NAMESPACE,
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
      const socket = this.server.sockets.sockets.get(socketId);
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
      const socket = this.server.sockets.sockets.get(socketId);
      if (!socket) {
        return false;
      }

      socket.disconnect(true);
      return true;
    });
  }

  handleConnection(client: Socket): void {
    this.logger.debug(`Agent socket connected: ${client.id}`);
    this.agentRealtimeService.incrementCounter('connection.opened');

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
        const previousSocket =
          this.server.sockets.sockets.get(previousSocketId);
        previousSocket?.disconnect(true);
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
      const message = error instanceof Error ? error.message : 'Invalid auth';
      client.emit(AGENT_REALTIME_SERVER_EVENTS.AUTH_ERROR, {
        type: AGENT_REALTIME_SERVER_EVENTS.AUTH_ERROR,
        authenticated: false,
        message,
      });
      client.disconnect(true);
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
      client.disconnect(true);
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
      client.disconnect(true);
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
      return this.emitHandlerError(
        client,
        AGENT_REALTIME_CLIENT_EVENTS.TASK_ACCEPTED,
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
      client.disconnect(true);
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
      return this.emitHandlerError(
        client,
        AGENT_REALTIME_CLIENT_EVENTS.TASK_STARTED,
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
      client.disconnect(true);
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
      return this.emitHandlerError(
        client,
        AGENT_REALTIME_CLIENT_EVENTS.TASK_LOG,
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
      client.disconnect(true);
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
      return this.emitHandlerError(
        client,
        AGENT_REALTIME_CLIENT_EVENTS.TASK_COMPLETED,
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
      client.disconnect(true);
      return { ok: false, message: 'Socket is not authenticated' };
    }

    try {
      const body = await this.validationPipe.transform(payload, {
        type: 'body',
        metatype: AgentMetricsMessageDto,
      });

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
      return this.emitHandlerError(
        client,
        AGENT_REALTIME_CLIENT_EVENTS.METRICS,
        error,
      );
    }
  }

  private emitHandlerError(client: Socket, eventType: string, error: unknown) {
    this.agentRealtimeService.incrementCounter('event.rejected.invalid');
    const message = error instanceof Error ? error.message : 'Invalid payload';
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
}
