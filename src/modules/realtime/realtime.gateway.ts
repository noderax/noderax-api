import {
  ConnectedSocket,
  OnGatewayInit,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger, UseGuards } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentSocketUser } from '../../common/decorators/current-socket-user.decorator';
import { AuthenticatedSocket } from '../../common/types/authenticated-socket.type';
import { AuthenticatedUser } from '../../common/types/authenticated-user.type';
import { Server, Socket } from 'socket.io';
import { buildRuntimeSocketCorsOptions } from '../../config';
import {
  REALTIME_ERROR_CODES,
  REALTIME_EVENTS,
  REALTIME_NODE_ROOM_PREFIX,
  REALTIME_WORKSPACE_ROOM_PREFIX,
} from '../../common/constants/realtime.constants';
import { NodeSubscriptionDto } from './dto/node-subscription.dto';
import { WorkspaceSubscriptionDto } from './dto/workspace-subscription.dto';
import { WsJwtAuthGuard } from './guards/ws-jwt-auth.guard';
import { WsNodeSubscriptionGuard } from './guards/ws-node-subscription.guard';
import { WsWorkspaceSubscriptionGuard } from './guards/ws-workspace-subscription.guard';
import { RealtimeAuthService } from './services/realtime-auth.service';

@Public()
@WebSocketGateway({
  namespace: 'realtime',
  cors: buildRuntimeSocketCorsOptions(),
})
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(private readonly realtimeAuthService: RealtimeAuthService) {}

  afterInit(server: Server) {
    server.use((client, next) => {
      void this.authenticateConnection(client, next);
    });
  }

  handleConnection(client: AuthenticatedSocket) {
    this.logger.debug(
      `Authenticated client connected: ${client.id} (${client.data.user.email})`,
    );
  }

  handleDisconnect(client: AuthenticatedSocket) {
    const email = client.data.user?.email ?? 'unknown-user';
    this.logger.debug(`Client disconnected: ${client.id} (${email})`);
  }

  @SubscribeMessage(REALTIME_EVENTS.SUBSCRIBE_NODE)
  @UseGuards(WsJwtAuthGuard, WsNodeSubscriptionGuard)
  handleNodeSubscription(
    @ConnectedSocket() client: AuthenticatedSocket,
    @CurrentSocketUser() _user: AuthenticatedUser,
    @MessageBody() payload: NodeSubscriptionDto,
  ) {
    client.join(`${REALTIME_NODE_ROOM_PREFIX}${payload.nodeId}`);
    return { subscribed: true, nodeId: payload.nodeId };
  }

  @SubscribeMessage(REALTIME_EVENTS.UNSUBSCRIBE_NODE)
  @UseGuards(WsJwtAuthGuard, WsNodeSubscriptionGuard)
  handleNodeUnsubscribe(
    @ConnectedSocket() client: AuthenticatedSocket,
    @CurrentSocketUser() _user: AuthenticatedUser,
    @MessageBody() payload: NodeSubscriptionDto,
  ) {
    client.leave(`${REALTIME_NODE_ROOM_PREFIX}${payload.nodeId}`);
    return { unsubscribed: true, nodeId: payload.nodeId };
  }

  @SubscribeMessage(REALTIME_EVENTS.SUBSCRIBE_WORKSPACE)
  @UseGuards(WsJwtAuthGuard, WsWorkspaceSubscriptionGuard)
  handleWorkspaceSubscription(
    @ConnectedSocket() client: AuthenticatedSocket,
    @CurrentSocketUser() _user: AuthenticatedUser,
    @MessageBody() payload: WorkspaceSubscriptionDto,
  ) {
    client.join(`${REALTIME_WORKSPACE_ROOM_PREFIX}${payload.workspaceId}`);
    return { subscribed: true, workspaceId: payload.workspaceId };
  }

  @SubscribeMessage(REALTIME_EVENTS.UNSUBSCRIBE_WORKSPACE)
  @UseGuards(WsJwtAuthGuard, WsWorkspaceSubscriptionGuard)
  handleWorkspaceUnsubscribe(
    @ConnectedSocket() client: AuthenticatedSocket,
    @CurrentSocketUser() _user: AuthenticatedUser,
    @MessageBody() payload: WorkspaceSubscriptionDto,
  ) {
    client.leave(`${REALTIME_WORKSPACE_ROOM_PREFIX}${payload.workspaceId}`);
    return { unsubscribed: true, workspaceId: payload.workspaceId };
  }

  emitNodeStatusUpdate(payload: Record<string, unknown>) {
    if (payload.nodeId) {
      this.server
        .to(`${REALTIME_NODE_ROOM_PREFIX}${payload.nodeId}`)
        .emit(REALTIME_EVENTS.NODE_STATUS_UPDATED, payload);
    }
  }

  emitNodeRootAccessUpdate(payload: Record<string, unknown>) {
    if (payload.nodeId) {
      this.server
        .to(`${REALTIME_NODE_ROOM_PREFIX}${payload.nodeId}`)
        .emit(REALTIME_EVENTS.NODE_ROOT_ACCESS_UPDATED, payload);
    }
  }

  emitMetricIngested(payload: Record<string, unknown>) {
    if (payload.nodeId) {
      this.server
        .to(`${REALTIME_NODE_ROOM_PREFIX}${payload.nodeId}`)
        .emit(REALTIME_EVENTS.METRICS_INGESTED, payload);
    }
  }

  emitTaskCreated(payload: Record<string, unknown>) {
    if (payload.nodeId) {
      this.server
        .to(`${REALTIME_NODE_ROOM_PREFIX}${payload.nodeId}`)
        .emit(REALTIME_EVENTS.TASK_CREATED, payload);
    }
  }

  emitTaskUpdated(payload: Record<string, unknown>) {
    if (payload.nodeId) {
      this.server
        .to(`${REALTIME_NODE_ROOM_PREFIX}${payload.nodeId}`)
        .emit(REALTIME_EVENTS.TASK_UPDATED, payload);
    }
  }

  emitEventCreated(payload: Record<string, unknown>) {
    if (payload.nodeId) {
      this.server
        .to(`${REALTIME_NODE_ROOM_PREFIX}${payload.nodeId}`)
        .emit(REALTIME_EVENTS.EVENT_CREATED, payload);
    }
  }

  emitNodeInstallUpdated(payload: Record<string, unknown>) {
    if (payload.workspaceId) {
      this.server
        .to(`${REALTIME_WORKSPACE_ROOM_PREFIX}${payload.workspaceId}`)
        .emit(REALTIME_EVENTS.NODE_INSTALL_UPDATED, payload);
    }
  }

  getActiveConnectionCount(): number {
    return this.server?.sockets.sockets.size ?? 0;
  }

  private async authenticateConnection(
    client: Socket,
    next: (error?: Error) => void,
  ): Promise<void> {
    try {
      const user = await this.realtimeAuthService.authenticateSocket(client);
      (client as AuthenticatedSocket).data.user = user;
      next();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Authentication failed';

      this.logger.warn(
        `Rejected websocket connection ${client.id}: ${message}`,
      );

      const connectionError = new Error(message) as Error & {
        data?: Record<string, string>;
      };
      connectionError.data = {
        code: REALTIME_ERROR_CODES.UNAUTHORIZED,
        message,
      };

      next(connectionError);
    }
  }
}
