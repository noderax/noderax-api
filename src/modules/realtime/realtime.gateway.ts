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

  @SubscribeMessage('subscribe.node')
  handleNodeSubscription(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { nodeId: string },
  ) {
    client.join(`node:${payload.nodeId}`);
    return { subscribed: true, nodeId: payload.nodeId };
  }

  @SubscribeMessage('unsubscribe.node')
  handleNodeUnsubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { nodeId: string },
  ) {
    client.leave(`node:${payload.nodeId}`);
    return { unsubscribed: true, nodeId: payload.nodeId };
  }

  emitNodeStatusUpdate(payload: Record<string, unknown>) {
    this.server.emit('node.status.updated', payload);
    if (payload.nodeId) {
      this.server
        .to(`node:${payload.nodeId}`)
        .emit('node.status.updated', payload);
    }
  }

  emitMetricIngested(payload: Record<string, unknown>) {
    this.server.emit('metrics.ingested', payload);
    if (payload.nodeId) {
      this.server
        .to(`node:${payload.nodeId}`)
        .emit('metrics.ingested', payload);
    }
  }

  emitTaskCreated(payload: Record<string, unknown>) {
    this.server.emit('task.created', payload);
    if (payload.nodeId) {
      this.server.to(`node:${payload.nodeId}`).emit('task.created', payload);
    }
  }

  emitTaskUpdated(payload: Record<string, unknown>) {
    this.server.emit('task.updated', payload);
    if (payload.nodeId) {
      this.server.to(`node:${payload.nodeId}`).emit('task.updated', payload);
    }
  }

  emitEventCreated(payload: Record<string, unknown>) {
    this.server.emit('event.created', payload);
    if (payload.nodeId) {
      this.server.to(`node:${payload.nodeId}`).emit('event.created', payload);
    }
  }
}
