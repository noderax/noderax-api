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
import { Server, Socket } from 'socket.io';
import { Public } from '../../common/decorators/public.decorator';
import { AuthenticatedSocket } from '../../common/types/authenticated-socket.type';
import {
  TERMINAL_ERROR_CODES,
  TERMINAL_EVENTS,
  TERMINAL_NAMESPACE,
  TERMINAL_SESSION_ROOM_PREFIX,
} from '../../common/constants/terminal.constants';
import { TerminalAttachMessageDto } from './dto/terminal-attach-message.dto';
import { TerminalInputMessageDto } from './dto/terminal-input-message.dto';
import { TerminalResizeMessageDto } from './dto/terminal-resize-message.dto';
import { TerminalTerminateMessageDto } from './dto/terminal-terminate-message.dto';
import { TerminalSocketAuthService } from './terminal-socket-auth.service';
import { TerminalSessionsService } from './terminal-sessions.service';

@Public()
@WebSocketGateway({
  namespace: TERMINAL_NAMESPACE,
  cors: {
    origin: '*',
    credentials: true,
  },
})
export class TerminalGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(TerminalGateway.name);
  private readonly validationPipe = new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  });

  constructor(
    private readonly terminalSocketAuthService: TerminalSocketAuthService,
    private readonly terminalSessionsService: TerminalSessionsService,
  ) {}

  afterInit(server: Server): void {
    server.use((client, next) => {
      void this.authenticateConnection(client, next);
    });

    this.terminalSessionsService.bindRoomEmitter((room, event, payload) => {
      this.server.to(room).emit(event, payload);
    });
  }

  handleConnection(client: AuthenticatedSocket): void {
    this.logger.debug(
      `Authenticated terminal client connected: ${client.id} (${client.data.user.email})`,
    );
  }

  async handleDisconnect(client: AuthenticatedSocket): Promise<void> {
    await this.terminalSessionsService.detachController(client.id);
    this.logger.debug(`Terminal client disconnected: ${client.id}`);
  }

  @SubscribeMessage(TERMINAL_EVENTS.ATTACH)
  async attach(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: TerminalAttachMessageDto,
  ) {
    try {
      const body = await this.validationPipe.transform(payload, {
        type: 'body',
        metatype: TerminalAttachMessageDto,
      });

      const session = await this.terminalSessionsService.attachController(
        body.sessionId,
        client.data.user,
        client.id,
      );

      this.logger.debug(
        `Terminal session attached: socket=${client.id} session=${session.id} user=${client.data.user.email}`,
      );

      client.join(this.buildRoom(body.sessionId));
      return {
        ok: true,
        session: {
          id: session.id,
          status: session.status,
          cols: session.cols,
          rows: session.rows,
        },
      };
    } catch (error) {
      return this.handleWsError(
        client,
        bodyOrUndefined(payload)?.sessionId,
        error,
      );
    }
  }

  @SubscribeMessage(TERMINAL_EVENTS.INPUT)
  async input(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: TerminalInputMessageDto,
  ) {
    try {
      const body = await this.validationPipe.transform(payload, {
        type: 'body',
        metatype: TerminalInputMessageDto,
      });

      await this.terminalSessionsService.handleControllerInput(
        body.sessionId,
        body.payload,
        client.data.user,
      );

      return { ok: true, sessionId: body.sessionId };
    } catch (error) {
      return this.handleWsError(
        client,
        bodyOrUndefined(payload)?.sessionId,
        error,
      );
    }
  }

  @SubscribeMessage(TERMINAL_EVENTS.RESIZE)
  async resize(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: TerminalResizeMessageDto,
  ) {
    try {
      const body = await this.validationPipe.transform(payload, {
        type: 'body',
        metatype: TerminalResizeMessageDto,
      });

      const session = await this.terminalSessionsService.handleControllerResize(
        body.sessionId,
        body.cols,
        body.rows,
        client.data.user,
      );

      return {
        ok: true,
        sessionId: session.id,
        cols: session.cols,
        rows: session.rows,
      };
    } catch (error) {
      return this.handleWsError(
        client,
        bodyOrUndefined(payload)?.sessionId,
        error,
      );
    }
  }

  @SubscribeMessage(TERMINAL_EVENTS.TERMINATE)
  async terminate(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: TerminalTerminateMessageDto,
  ) {
    try {
      const body = await this.validationPipe.transform(payload, {
        type: 'body',
        metatype: TerminalTerminateMessageDto,
      });

      const session = await this.terminalSessionsService.terminateSession(
        undefined,
        body.sessionId,
        { reason: body.reason },
        client.data.user,
      );

      return { ok: true, sessionId: session.id, status: session.status };
    } catch (error) {
      return this.handleWsError(
        client,
        bodyOrUndefined(payload)?.sessionId,
        error,
      );
    }
  }

  private async authenticateConnection(
    client: Socket,
    next: (error?: Error) => void,
  ): Promise<void> {
    try {
      const user =
        await this.terminalSocketAuthService.authenticateSocket(client);
      (client as AuthenticatedSocket).data.user = user;
      next();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Authentication failed';
      const connectionError = new Error(message) as Error & {
        data?: Record<string, string>;
      };
      connectionError.data = {
        code: TERMINAL_ERROR_CODES.UNAUTHORIZED,
        message,
      };
      next(connectionError);
    }
  }

  private handleWsError(
    client: AuthenticatedSocket,
    sessionId: string | undefined,
    error: unknown,
  ) {
    const message =
      error instanceof Error ? error.message : 'Terminal request failed.';
    this.logger.warn(
      `Terminal websocket request failed: socket=${client.id} session=${sessionId ?? 'unknown'} message=${message}`,
    );
    (client as unknown as Socket).emit(TERMINAL_EVENTS.ERROR, {
      sessionId: sessionId ?? null,
      message,
    });
    return { ok: false, message };
  }

  private buildRoom(sessionId: string): string {
    return `${TERMINAL_SESSION_ROOM_PREFIX}${sessionId}`;
  }
}

const bodyOrUndefined = (
  payload: unknown,
): { sessionId?: string } | undefined =>
  payload && typeof payload === 'object'
    ? (payload as { sessionId?: string })
    : undefined;
