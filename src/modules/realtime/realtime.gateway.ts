import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import {
  REALTIME_EVENTS,
  REALTIME_NODE_ROOM_PREFIX,
} from '../../common/constants/realtime.constants';

@WebSocketGateway({
  namespace: 'realtime',
  cors: {
    origin: '*',
    credentials: true,
  },
})
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(RealtimeGateway.name);

  handleConnection(client: Socket) {
    this.logger.debug(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage(REALTIME_EVENTS.SUBSCRIBE_NODE)
  handleNodeSubscription(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { nodeId: string },
  ) {
    client.join(`${REALTIME_NODE_ROOM_PREFIX}${payload.nodeId}`);
    return { subscribed: true, nodeId: payload.nodeId };
  }

  @SubscribeMessage(REALTIME_EVENTS.UNSUBSCRIBE_NODE)
  handleNodeUnsubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { nodeId: string },
  ) {
    client.leave(`${REALTIME_NODE_ROOM_PREFIX}${payload.nodeId}`);
    return { unsubscribed: true, nodeId: payload.nodeId };
  }

  emitNodeStatusUpdate(payload: Record<string, unknown>) {
    this.server.emit(REALTIME_EVENTS.NODE_STATUS_UPDATED, payload);
    if (payload.nodeId) {
      this.server
        .to(`${REALTIME_NODE_ROOM_PREFIX}${payload.nodeId}`)
        .emit(REALTIME_EVENTS.NODE_STATUS_UPDATED, payload);
    }
  }

  emitMetricIngested(payload: Record<string, unknown>) {
    this.server.emit(REALTIME_EVENTS.METRICS_INGESTED, payload);
    if (payload.nodeId) {
      this.server
        .to(`${REALTIME_NODE_ROOM_PREFIX}${payload.nodeId}`)
        .emit(REALTIME_EVENTS.METRICS_INGESTED, payload);
    }
  }

  emitTaskCreated(payload: Record<string, unknown>) {
    this.server.emit(REALTIME_EVENTS.TASK_CREATED, payload);
    if (payload.nodeId) {
      this.server
        .to(`${REALTIME_NODE_ROOM_PREFIX}${payload.nodeId}`)
        .emit(REALTIME_EVENTS.TASK_CREATED, payload);
    }
  }

  emitTaskUpdated(payload: Record<string, unknown>) {
    this.server.emit(REALTIME_EVENTS.TASK_UPDATED, payload);
    if (payload.nodeId) {
      this.server
        .to(`${REALTIME_NODE_ROOM_PREFIX}${payload.nodeId}`)
        .emit(REALTIME_EVENTS.TASK_UPDATED, payload);
    }
  }

  emitEventCreated(payload: Record<string, unknown>) {
    this.server.emit(REALTIME_EVENTS.EVENT_CREATED, payload);
    if (payload.nodeId) {
      this.server
        .to(`${REALTIME_NODE_ROOM_PREFIX}${payload.nodeId}`)
        .emit(REALTIME_EVENTS.EVENT_CREATED, payload);
    }
  }
}
