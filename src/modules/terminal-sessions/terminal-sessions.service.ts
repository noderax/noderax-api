import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PUBSUB_CHANNELS } from '../../common/constants/pubsub.constants';
import {
  TERMINAL_ATTACH_GRACE_SECONDS,
  TERMINAL_EVENTS,
  TERMINAL_MAX_TRANSCRIPT_BYTES,
  TERMINAL_PENDING_OPEN_TIMEOUT_MS,
  TERMINAL_REDIS_KEYS,
  TERMINAL_SESSION_ROOM_PREFIX,
  TERMINAL_TERMINATION_TIMEOUT_MS,
  TERMINAL_TRANSCRIPT_RETENTION_DAYS,
} from '../../common/constants/terminal.constants';
import { AuthenticatedUser } from '../../common/types/authenticated-user.type';
import { RequestAuditContext } from '../../common/types/request-audit-context.type';
import { RedisService } from '../../redis/redis.service';
import { AgentRealtimeService } from '../agent-realtime/agent-realtime.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { NodeStatus } from '../nodes/entities/node-status.enum';
import { NodesService } from '../nodes/nodes.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { CreateTerminalSessionDto } from './dto/create-terminal-session.dto';
import { QueryTerminalSessionChunksDto } from './dto/query-terminal-session-chunks.dto';
import { QueryTerminalSessionsDto } from './dto/query-terminal-sessions.dto';
import { TerminalSessionChunkEntity } from './entities/terminal-session-chunk.entity';
import { TerminalSessionEntity } from './entities/terminal-session.entity';
import { TerminalSessionStatus } from './entities/terminal-session-status.enum';
import { TerminalTranscriptDirection } from './entities/terminal-transcript-direction.enum';
import { TerminateTerminalSessionDto } from './dto/terminate-terminal-session.dto';

type RoomEmitter = (
  room: string,
  event: string,
  payload: Record<string, unknown>,
) => void;

type SocketAttachment = {
  sessionId: string;
  userId: string;
};

type PubsubPayload = Record<string, unknown> & {
  sourceInstanceId?: string;
  sessionId?: string;
};

type TerminalSessionMetadataPatch = Partial<
  Pick<
    TerminalSessionEntity,
    | 'status'
    | 'openedAt'
    | 'closedAt'
    | 'closedReason'
    | 'exitCode'
    | 'cols'
    | 'rows'
  >
>;

@Injectable()
export class TerminalSessionsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TerminalSessionsService.name);
  private readonly pendingOpenTimers = new Map<string, NodeJS.Timeout>();
  private readonly detachTimers = new Map<string, NodeJS.Timeout>();
  private readonly terminationTimers = new Map<string, NodeJS.Timeout>();
  private readonly socketToAttachment = new Map<string, SocketAttachment>();
  private readonly localControllerCounts = new Map<string, number>();
  private readonly unsubscribers: Array<() => Promise<void>> = [];

  private roomEmitter: RoomEmitter | null = null;

  constructor(
    @InjectRepository(TerminalSessionEntity)
    private readonly sessionsRepository: Repository<TerminalSessionEntity>,
    @InjectRepository(TerminalSessionChunkEntity)
    private readonly chunksRepository: Repository<TerminalSessionChunkEntity>,
    private readonly nodesService: NodesService,
    private readonly workspacesService: WorkspacesService,
    private readonly agentRealtimeService: AgentRealtimeService,
    private readonly auditLogsService: AuditLogsService,
    private readonly redisService: RedisService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.redisService.isEnabled()) {
      return;
    }

    this.unsubscribers.push(
      await this.redisService.subscribe(
        PUBSUB_CHANNELS.TERMINAL_SESSION_STATE,
        (payload) =>
          this.forwardPubsubEvent(TERMINAL_EVENTS.SESSION_STATE, payload),
      ),
      await this.redisService.subscribe(
        PUBSUB_CHANNELS.TERMINAL_SESSION_OUTPUT,
        (payload) => this.forwardPubsubEvent(TERMINAL_EVENTS.OUTPUT, payload),
      ),
      await this.redisService.subscribe(
        PUBSUB_CHANNELS.TERMINAL_SESSION_CLOSED,
        (payload) => this.forwardPubsubEvent(TERMINAL_EVENTS.CLOSED, payload),
      ),
      await this.redisService.subscribe(
        PUBSUB_CHANNELS.TERMINAL_SESSION_ERROR,
        (payload) => this.forwardPubsubEvent(TERMINAL_EVENTS.ERROR, payload),
      ),
    );
  }

  async onModuleDestroy(): Promise<void> {
    for (const unsubscribe of this.unsubscribers) {
      await unsubscribe();
    }

    this.unsubscribers.length = 0;

    for (const timer of this.pendingOpenTimers.values()) {
      clearTimeout(timer);
    }
    this.pendingOpenTimers.clear();

    for (const timer of this.detachTimers.values()) {
      clearTimeout(timer);
    }
    this.detachTimers.clear();

    for (const timer of this.terminationTimers.values()) {
      clearTimeout(timer);
    }
    this.terminationTimers.clear();
  }

  bindRoomEmitter(emitter: RoomEmitter): void {
    this.roomEmitter = emitter;
  }

  async createSession(
    workspaceId: string,
    nodeId: string,
    dto: CreateTerminalSessionDto,
    user: AuthenticatedUser,
    context?: RequestAuditContext,
  ): Promise<TerminalSessionEntity> {
    await this.workspacesService.assertWorkspaceAdmin(workspaceId, user);
    await this.workspacesService.assertWorkspaceWritable(workspaceId);

    const node = await this.nodesService.findOneOrFail(nodeId, workspaceId);
    if (node.status !== NodeStatus.ONLINE) {
      throw new BadRequestException(
        `Node ${node.hostname} is offline and cannot accept an interactive terminal session.`,
      );
    }

    const hasRoute = await this.agentRealtimeService.hasActiveNodeRoute(
      node.id,
    );
    if (!hasRoute) {
      throw new ConflictException(
        `Node ${node.hostname} does not have an active agent realtime route.`,
      );
    }

    const session = await this.sessionsRepository.save(
      this.sessionsRepository.create({
        workspaceId,
        nodeId: node.id,
        createdByUserId: user.id,
        createdByEmailSnapshot: user.email,
        status: TerminalSessionStatus.PENDING,
        openedAt: null,
        closedAt: null,
        closedReason: null,
        exitCode: null,
        cols: dto.cols ?? 120,
        rows: dto.rows ?? 34,
        retentionExpiresAt: this.buildRetentionExpiry(),
        transcriptBytes: '0',
        chunkCount: 0,
        lastChunkSeq: 0,
      }),
    );

    this.logger.debug(
      `Creating terminal session ${session.id} for node ${node.id} by ${user.email}`,
    );

    await this.appendChunk(session, {
      direction: TerminalTranscriptDirection.SYSTEM,
      payload: Buffer.from(
        `Session created by ${user.email} on node ${node.hostname}`,
        'utf8',
      ).toString('base64'),
    });

    await this.auditLogsService.record({
      scope: 'workspace',
      workspaceId,
      action: 'terminal.session.created',
      targetType: 'terminal_session',
      targetId: session.id,
      targetLabel: node.hostname,
      metadata: {
        nodeId: node.id,
        cols: session.cols,
        rows: session.rows,
      },
      context,
    });

    await this.publishSessionState(session);
    this.schedulePendingOpenTimeout(session.id);

    const dispatched = await this.agentRealtimeService.startTerminalSession(
      node.id,
      {
        sessionId: session.id,
        cols: session.cols,
        rows: session.rows,
      },
    );

    if (!dispatched) {
      return this.markFailed(
        session.id,
        workspaceId,
        'Agent route was not available to start the terminal session.',
      );
    }

    return session;
  }

  async listNodeSessions(
    workspaceId: string,
    nodeId: string,
    _user: AuthenticatedUser,
    query: QueryTerminalSessionsDto,
  ): Promise<TerminalSessionEntity[]> {
    await this.nodesService.findOneOrFail(nodeId, workspaceId);

    return this.sessionsRepository.find({
      where: { workspaceId, nodeId },
      order: { createdAt: 'DESC' },
      take: query.limit ?? 20,
      skip: query.offset ?? 0,
    });
  }

  async getSession(
    workspaceId: string,
    sessionId: string,
    user: AuthenticatedUser,
  ): Promise<TerminalSessionEntity> {
    const session = await this.findSessionOrFail(sessionId, workspaceId);
    this.assertCanReadSession(user, session);
    return session;
  }

  async getSessionChunks(
    workspaceId: string,
    sessionId: string,
    user: AuthenticatedUser,
    query: QueryTerminalSessionChunksDto,
  ): Promise<TerminalSessionChunkEntity[]> {
    const session = await this.findSessionOrFail(sessionId, workspaceId);
    this.assertCanReadSession(user, session);

    if (
      session.retentionExpiresAt.getTime() <= Date.now() &&
      session.status !== TerminalSessionStatus.OPEN &&
      session.status !== TerminalSessionStatus.TERMINATING
    ) {
      throw new GoneException(
        'Transcript retention expired for this terminal session.',
      );
    }

    return this.chunksRepository.find({
      where: { sessionId: session.id },
      order: { seq: 'ASC' },
      take: query.limit ?? 200,
      skip: query.offset ?? 0,
    });
  }

  async terminateSession(
    workspaceId: string | undefined,
    sessionId: string,
    dto: TerminateTerminalSessionDto | undefined,
    user: AuthenticatedUser,
    context?: RequestAuditContext,
  ): Promise<TerminalSessionEntity> {
    const session = await this.findSessionOrFail(sessionId, workspaceId);
    await this.workspacesService.assertWorkspaceAdmin(
      session.workspaceId,
      user,
    );
    await this.workspacesService.assertWorkspaceWritable(session.workspaceId);
    if (this.isTerminal(session.status)) {
      return session;
    }

    await this.appendChunk(session, {
      direction: TerminalTranscriptDirection.SYSTEM,
      payload: Buffer.from(
        dto?.reason?.trim()
          ? `Termination requested: ${dto.reason.trim()}`
          : `Termination requested by ${user.email}`,
        'utf8',
      ).toString('base64'),
    });

    session.status = TerminalSessionStatus.TERMINATING;
    await this.updateSessionMetadata(session, {
      status: session.status,
    });
    await this.publishSessionState(session);
    this.scheduleTerminationTimeout(session.id);

    await this.auditLogsService.record({
      scope: 'workspace',
      workspaceId: session.workspaceId,
      action: 'terminal.session.terminate.requested',
      targetType: 'terminal_session',
      targetId: session.id,
      targetLabel: session.nodeId,
      metadata: {
        nodeId: session.nodeId,
        reason: dto?.reason?.trim() || null,
      },
      context,
    });

    const dispatched = await this.agentRealtimeService.stopTerminalSession(
      session.nodeId,
      {
        sessionId: session.id,
        reason: dto?.reason?.trim() || null,
      },
    );

    if (!dispatched) {
      return this.closeSession(session, {
        status: TerminalSessionStatus.CLOSED,
        reason:
          dto?.reason?.trim() ||
          'Terminal route was unavailable while terminating the session.',
        exitCode: null,
      });
    }

    return this.findSessionOrFail(session.id, workspaceId);
  }

  async attachController(
    sessionId: string,
    user: AuthenticatedUser,
    socketId: string,
  ): Promise<TerminalSessionEntity> {
    if (this.socketToAttachment.has(socketId)) {
      await this.detachController(socketId);
    }

    const session = await this.findSessionOrFail(sessionId);
    await this.workspacesService.assertWorkspaceAdmin(
      session.workspaceId,
      user,
    );
    this.assertCanControlSession(user, session);
    await this.workspacesService.assertWorkspaceWritable(session.workspaceId);

    this.clearDetachTimer(session.id);
    this.socketToAttachment.set(socketId, {
      sessionId: session.id,
      userId: user.id,
    });
    await this.incrementControllerCount(session.id);

    this.logger.debug(
      `Controller attached to terminal session ${session.id}: socket=${socketId} user=${user.email}`,
    );

    this.emitToRoom(session.id, TERMINAL_EVENTS.SESSION_STATE, {
      session: this.toSessionPayload(session),
    });

    return session;
  }

  async detachController(socketId: string): Promise<void> {
    const attachment = this.socketToAttachment.get(socketId);
    if (!attachment) {
      return;
    }

    this.socketToAttachment.delete(socketId);
    const count = await this.decrementControllerCount(attachment.sessionId);
    if (count <= 0) {
      this.scheduleDetachTermination(attachment.sessionId);
    }
  }

  async handleControllerInput(
    sessionId: string,
    payload: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    const session = await this.findSessionOrFail(sessionId);
    await this.workspacesService.assertWorkspaceAdmin(
      session.workspaceId,
      user,
    );
    this.assertCanControlSession(user, session);
    await this.workspacesService.assertWorkspaceWritable(session.workspaceId);

    if (session.status !== TerminalSessionStatus.OPEN) {
      throw new ConflictException('Terminal session is not open for input.');
    }

    await this.appendChunk(session, {
      direction: TerminalTranscriptDirection.STDIN,
      payload,
    });

    const dispatched = await this.agentRealtimeService.sendTerminalInput(
      session.nodeId,
      {
        sessionId: session.id,
        payload,
      },
    );

    if (!dispatched) {
      await this.markFailed(
        session.id,
        session.workspaceId,
        'Agent route was unavailable while sending terminal input.',
      );
    }
  }

  async handleControllerResize(
    sessionId: string,
    cols: number,
    rows: number,
    user: AuthenticatedUser,
  ): Promise<TerminalSessionEntity> {
    const session = await this.findSessionOrFail(sessionId);
    await this.workspacesService.assertWorkspaceAdmin(
      session.workspaceId,
      user,
    );
    this.assertCanControlSession(user, session);
    await this.workspacesService.assertWorkspaceWritable(session.workspaceId);

    if (session.status === TerminalSessionStatus.PENDING) {
      session.cols = cols;
      session.rows = rows;
      await this.updateSessionMetadata(session, {
        cols: session.cols,
        rows: session.rows,
      });
      await this.publishSessionState(session);
      return session;
    }

    if (session.status !== TerminalSessionStatus.OPEN) {
      throw new ConflictException('Terminal session is not open for resize.');
    }

    session.cols = cols;
    session.rows = rows;
    await this.updateSessionMetadata(session, {
      cols: session.cols,
      rows: session.rows,
    });
    await this.publishSessionState(session);

    const dispatched = await this.agentRealtimeService.resizeTerminalSession(
      session.nodeId,
      {
        sessionId: session.id,
        cols,
        rows,
      },
    );

    if (!dispatched) {
      await this.markFailed(
        session.id,
        session.workspaceId,
        'Agent route was unavailable while resizing the terminal.',
      );
    }

    return session;
  }

  async handleAgentOpened(input: {
    sessionId: string;
    nodeId: string;
    cols?: number;
    rows?: number;
    timestamp?: string;
  }): Promise<TerminalSessionEntity> {
    const session = await this.findSessionOrFail(input.sessionId);
    if (session.nodeId !== input.nodeId || this.isTerminal(session.status)) {
      return session;
    }

    this.clearPendingOpenTimer(session.id);
    session.status = TerminalSessionStatus.OPEN;
    session.openedAt = this.parseOptionalDate(input.timestamp) ?? new Date();
    session.closedAt = null;
    session.closedReason = null;
    session.exitCode = null;
    if (input.cols) {
      session.cols = input.cols;
    }
    if (input.rows) {
      session.rows = input.rows;
    }

    const saved = await this.updateSessionMetadata(session, {
      status: session.status,
      openedAt: session.openedAt,
      closedAt: session.closedAt,
      closedReason: session.closedReason,
      exitCode: session.exitCode,
      cols: session.cols,
      rows: session.rows,
    });

    this.logger.debug(
      `Terminal session opened: session=${saved.id} node=${saved.nodeId}`,
    );

    await this.appendChunk(saved, {
      direction: TerminalTranscriptDirection.SYSTEM,
      payload: Buffer.from('Terminal session opened', 'utf8').toString(
        'base64',
      ),
      sourceTimestamp: saved.openedAt ?? new Date(),
    });

    await this.auditLogsService.record({
      scope: 'workspace',
      workspaceId: saved.workspaceId,
      action: 'terminal.session.opened',
      targetType: 'terminal_session',
      targetId: saved.id,
      targetLabel: saved.nodeId,
      metadata: {
        nodeId: saved.nodeId,
      },
    });

    await this.publishSessionState(saved);
    return saved;
  }

  async handleAgentOutput(input: {
    sessionId: string;
    nodeId: string;
    direction: TerminalTranscriptDirection;
    payload: string;
    timestamp?: string;
  }): Promise<TerminalSessionChunkEntity | null> {
    const session = await this.findSessionOrFail(input.sessionId);
    if (session.nodeId !== input.nodeId || this.isTerminal(session.status)) {
      return null;
    }

    const currentBytes = this.readTranscriptBytes(session);
    const decodedBytes = Buffer.from(input.payload, 'base64').byteLength;
    if (currentBytes + decodedBytes > TERMINAL_MAX_TRANSCRIPT_BYTES) {
      await this.appendChunk(session, {
        direction: TerminalTranscriptDirection.SYSTEM,
        payload: Buffer.from(
          'Transcript capacity exceeded; terminating session.',
          'utf8',
        ).toString('base64'),
      });
      session.status = TerminalSessionStatus.TERMINATING;
      session.closedReason = 'transcript-overflow';
      await this.updateSessionMetadata(session, {
        status: session.status,
        closedReason: session.closedReason,
      });
      await this.publishSessionState(session);
      this.scheduleTerminationTimeout(session.id);

      const dispatched = await this.agentRealtimeService.stopTerminalSession(
        session.nodeId,
        {
          sessionId: session.id,
          reason: 'transcript-overflow',
        },
      );

      if (!dispatched) {
        await this.closeSession(session, {
          status: TerminalSessionStatus.FAILED,
          reason:
            'Transcript capacity exceeded and the terminal could not be stopped cleanly.',
          exitCode: null,
        });
      }

      return null;
    }

    const chunk = await this.appendChunk(session, {
      direction: input.direction,
      payload: input.payload,
      sourceTimestamp: this.parseOptionalDate(input.timestamp) ?? undefined,
    });

    await this.publishOutput(session.id, chunk);
    return chunk;
  }

  async handleAgentExited(input: {
    sessionId: string;
    nodeId: string;
    exitCode?: number | null;
    reason?: string | null;
    timestamp?: string;
  }): Promise<TerminalSessionEntity> {
    const session = await this.findSessionOrFail(input.sessionId);
    if (session.nodeId !== input.nodeId || this.isTerminal(session.status)) {
      return session;
    }

    return this.closeSession(session, {
      status: TerminalSessionStatus.CLOSED,
      reason: input.reason?.trim() || 'Terminal session exited.',
      exitCode:
        typeof input.exitCode === 'number' ? Math.trunc(input.exitCode) : null,
      closedAt: this.parseOptionalDate(input.timestamp) ?? new Date(),
    });
  }

  async handleAgentError(input: {
    sessionId: string;
    nodeId: string;
    message: string;
    timestamp?: string;
  }): Promise<TerminalSessionEntity> {
    return this.markFailed(
      input.sessionId,
      undefined,
      input.message,
      input.nodeId,
      input.timestamp,
    );
  }

  @Cron('0 */10 * * * *')
  async cleanupExpiredTranscripts(): Promise<void> {
    const expiredSessions = await this.sessionsRepository
      .createQueryBuilder('session')
      .select(['session.id'])
      .where('session.retentionExpiresAt <= :now', { now: new Date() })
      .getMany();

    if (expiredSessions.length === 0) {
      return;
    }

    const sessionIds = expiredSessions.map((session) => session.id);
    const deleteResult = await this.chunksRepository
      .createQueryBuilder()
      .delete()
      .where('"sessionId" IN (:...sessionIds)', { sessionIds })
      .execute();

    await this.auditLogsService.record({
      scope: 'platform',
      action: 'terminal.transcript.retention.cleaned',
      targetType: 'terminal_session_chunk',
      metadata: {
        sessionCount: sessionIds.length,
        deletedChunkCount: deleteResult.affected ?? 0,
      },
    });
  }

  private async markFailed(
    sessionId: string,
    workspaceId?: string,
    message?: string,
    nodeId?: string,
    timestamp?: string,
  ): Promise<TerminalSessionEntity> {
    const session = await this.findSessionOrFail(sessionId, workspaceId);
    if (nodeId && session.nodeId !== nodeId) {
      return session;
    }
    if (this.isTerminal(session.status)) {
      return session;
    }

    this.logger.warn(
      `Marking terminal session as failed: session=${session.id} node=${session.nodeId} reason=${message?.trim() || 'Terminal session failed.'}`,
    );

    return this.closeSession(session, {
      status: TerminalSessionStatus.FAILED,
      reason: message?.trim() || 'Terminal session failed.',
      exitCode: null,
      closedAt: this.parseOptionalDate(timestamp) ?? new Date(),
    });
  }

  private async closeSession(
    session: TerminalSessionEntity,
    input: {
      status: TerminalSessionStatus.CLOSED | TerminalSessionStatus.FAILED;
      reason: string;
      exitCode: number | null;
      closedAt?: Date;
    },
  ): Promise<TerminalSessionEntity> {
    this.clearPendingOpenTimer(session.id);
    this.clearDetachTimer(session.id);
    this.clearTerminationTimer(session.id);

    session.status = input.status;
    session.closedAt = input.closedAt ?? new Date();
    session.closedReason = input.reason;
    session.exitCode = input.exitCode;

    const saved = await this.updateSessionMetadata(session, {
      status: session.status,
      closedAt: session.closedAt,
      closedReason: session.closedReason,
      exitCode: session.exitCode,
    });
    await this.appendChunk(saved, {
      direction:
        input.status === TerminalSessionStatus.FAILED
          ? TerminalTranscriptDirection.STDERR
          : TerminalTranscriptDirection.SYSTEM,
      payload: Buffer.from(input.reason, 'utf8').toString('base64'),
      sourceTimestamp: saved.closedAt ?? new Date(),
    });

    await this.auditLogsService.record({
      scope: 'workspace',
      workspaceId: saved.workspaceId,
      action:
        input.status === TerminalSessionStatus.FAILED
          ? 'terminal.session.failed'
          : 'terminal.session.closed',
      targetType: 'terminal_session',
      targetId: saved.id,
      targetLabel: saved.nodeId,
      metadata: {
        nodeId: saved.nodeId,
        closedReason: saved.closedReason,
        exitCode: saved.exitCode,
      },
    });

    await this.publishSessionState(saved);
    if (input.status === TerminalSessionStatus.FAILED) {
      await this.publishError(saved.id, input.reason);
    }
    await this.publishClosed(saved);
    return saved;
  }

  private async findSessionOrFail(
    sessionId: string,
    workspaceId?: string,
  ): Promise<TerminalSessionEntity> {
    const session = await this.sessionsRepository.findOne({
      where: workspaceId ? { id: sessionId, workspaceId } : { id: sessionId },
    });

    if (!session) {
      throw new NotFoundException(
        `Terminal session ${sessionId} was not found.`,
      );
    }

    return session;
  }

  private assertCanReadSession(
    user: AuthenticatedUser,
    session: TerminalSessionEntity,
  ): void {
    if (
      !this.isTerminal(session.status) &&
      session.createdByUserId &&
      session.createdByUserId !== user.id
    ) {
      throw new ForbiddenException(
        'Only the session creator can inspect a live terminal session.',
      );
    }
  }

  private assertCanControlSession(
    user: AuthenticatedUser,
    session: TerminalSessionEntity,
  ): void {
    if (session.createdByUserId !== user.id) {
      throw new ForbiddenException(
        'Only the session creator can control this live terminal session.',
      );
    }

    if (this.isTerminal(session.status)) {
      throw new ConflictException('Terminal session is no longer active.');
    }
  }

  private async appendChunk(
    session: TerminalSessionEntity,
    input: {
      direction: TerminalTranscriptDirection;
      payload: string;
      sourceTimestamp?: Date;
    },
  ): Promise<TerminalSessionChunkEntity> {
    try {
      return await this.appendChunkOnce(session, input);
    } catch (error) {
      if (!this.isChunkSequenceConflict(error)) {
        throw error;
      }

      this.logger.warn(
        `Detected terminal transcript sequence drift; reconciling and retrying chunk append for session ${session.id}.`,
      );

      await this.reconcileTranscriptState(session);
      return this.appendChunkOnce(session, input);
    }
  }

  private async appendChunkOnce(
    session: TerminalSessionEntity,
    input: {
      direction: TerminalTranscriptDirection;
      payload: string;
      sourceTimestamp?: Date;
    },
  ): Promise<TerminalSessionChunkEntity> {
    const payloadBytes = Buffer.from(input.payload, 'base64').byteLength;

    const transactionResult = await this.sessionsRepository.manager.transaction(
      async (entityManager) => {
        const updateResult = await entityManager
          .createQueryBuilder()
          .update(TerminalSessionEntity)
          .set({
            lastChunkSeq: () => '"lastChunkSeq" + 1',
            chunkCount: () => '"chunkCount" + 1',
            transcriptBytes: () => `"transcriptBytes" + ${payloadBytes}`,
            updatedAt: () => 'CURRENT_TIMESTAMP',
          })
          .where('id = :sessionId', { sessionId: session.id })
          .returning([
            'lastChunkSeq',
            'chunkCount',
            'transcriptBytes',
            'updatedAt',
          ])
          .execute();

        const rawUpdateResult = Array.isArray(updateResult.raw)
          ? updateResult.raw[0]
          : updateResult.raw;

        if (!rawUpdateResult || typeof rawUpdateResult !== 'object') {
          throw new Error(
            `Terminal session chunk allocation failed for session ${session.id}.`,
          );
        }

        const nextSeq = this.readNumericReturningValue(rawUpdateResult, [
          'lastChunkSeq',
          'lastchunkseq',
        ]);
        const nextChunkCount = this.readNumericReturningValue(rawUpdateResult, [
          'chunkCount',
          'chunkcount',
        ]);
        const nextTranscriptBytes = this.readNumericReturningValue(
          rawUpdateResult,
          ['transcriptBytes', 'transcriptbytes'],
        );
        const nextUpdatedAt =
          this.readDateReturningValue(rawUpdateResult, [
            'updatedAt',
            'updatedat',
          ]) ?? new Date();

        const chunkRepository = entityManager.getRepository(
          TerminalSessionChunkEntity,
        );
        const chunk = chunkRepository.create({
          sessionId: session.id,
          direction: input.direction,
          encoding: 'base64',
          payload: input.payload,
          seq: nextSeq,
          sourceTimestamp: input.sourceTimestamp ?? null,
        });

        const savedChunk = await chunkRepository.save(chunk);

        return {
          chunk: savedChunk,
          lastChunkSeq: nextSeq,
          chunkCount: nextChunkCount,
          transcriptBytes: nextTranscriptBytes,
          updatedAt: nextUpdatedAt,
        };
      },
    );

    session.lastChunkSeq = transactionResult.lastChunkSeq;
    session.chunkCount = transactionResult.chunkCount;
    session.transcriptBytes = String(transactionResult.transcriptBytes);
    session.updatedAt = transactionResult.updatedAt;

    return transactionResult.chunk;
  }

  private readTranscriptBytes(session: TerminalSessionEntity): number {
    const raw = Number(session.transcriptBytes ?? 0);
    return Number.isFinite(raw) && raw >= 0 ? raw : 0;
  }

  private async publishSessionState(
    session: TerminalSessionEntity,
  ): Promise<void> {
    const payload = {
      sessionId: session.id,
      session: this.toSessionPayload(session),
      sourceInstanceId: this.redisService.getInstanceId(),
    };

    this.emitToRoom(session.id, TERMINAL_EVENTS.SESSION_STATE, payload);
    await this.redisService.publish(
      PUBSUB_CHANNELS.TERMINAL_SESSION_STATE,
      payload,
    );
  }

  private async publishOutput(
    sessionId: string,
    chunk: TerminalSessionChunkEntity,
  ): Promise<void> {
    const payload = {
      sessionId,
      chunk: this.toChunkPayload(chunk),
      sourceInstanceId: this.redisService.getInstanceId(),
    };

    this.emitToRoom(sessionId, TERMINAL_EVENTS.OUTPUT, payload);
    await this.redisService.publish(
      PUBSUB_CHANNELS.TERMINAL_SESSION_OUTPUT,
      payload,
    );
  }

  private async publishClosed(session: TerminalSessionEntity): Promise<void> {
    const payload = {
      sessionId: session.id,
      session: this.toSessionPayload(session),
      sourceInstanceId: this.redisService.getInstanceId(),
    };

    this.emitToRoom(session.id, TERMINAL_EVENTS.CLOSED, payload);
    await this.redisService.publish(
      PUBSUB_CHANNELS.TERMINAL_SESSION_CLOSED,
      payload,
    );
  }

  private async publishError(
    sessionId: string,
    message: string,
  ): Promise<void> {
    const payload = {
      sessionId,
      message,
      sourceInstanceId: this.redisService.getInstanceId(),
    };

    this.emitToRoom(sessionId, TERMINAL_EVENTS.ERROR, payload);
    await this.redisService.publish(
      PUBSUB_CHANNELS.TERMINAL_SESSION_ERROR,
      payload,
    );
  }

  private forwardPubsubEvent(eventName: string, payload: PubsubPayload): void {
    if (payload.sourceInstanceId === this.redisService.getInstanceId()) {
      return;
    }

    const sessionId =
      typeof payload.sessionId === 'string' ? payload.sessionId : null;
    if (!sessionId) {
      return;
    }

    this.emitToRoom(sessionId, eventName, payload);
  }

  private emitToRoom(
    sessionId: string,
    eventName: string,
    payload: Record<string, unknown>,
  ): void {
    if (!this.roomEmitter) {
      return;
    }

    this.roomEmitter(this.buildRoom(sessionId), eventName, payload);
  }

  private buildRoom(sessionId: string): string {
    return `${TERMINAL_SESSION_ROOM_PREFIX}${sessionId}`;
  }

  private toSessionPayload(
    session: TerminalSessionEntity,
  ): Record<string, unknown> {
    return {
      id: session.id,
      workspaceId: session.workspaceId,
      nodeId: session.nodeId,
      createdByUserId: session.createdByUserId,
      createdByEmailSnapshot: session.createdByEmailSnapshot,
      status: session.status,
      openedAt: session.openedAt?.toISOString() ?? null,
      closedAt: session.closedAt?.toISOString() ?? null,
      closedReason: session.closedReason,
      exitCode: session.exitCode,
      cols: session.cols,
      rows: session.rows,
      retentionExpiresAt: session.retentionExpiresAt.toISOString(),
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
    };
  }

  private toChunkPayload(
    chunk: TerminalSessionChunkEntity,
  ): Record<string, unknown> {
    return {
      id: chunk.id,
      sessionId: chunk.sessionId,
      direction: chunk.direction,
      encoding: chunk.encoding,
      payload: chunk.payload,
      seq: chunk.seq,
      sourceTimestamp: chunk.sourceTimestamp?.toISOString() ?? null,
      createdAt: chunk.createdAt.toISOString(),
    };
  }

  private buildRetentionExpiry(): Date {
    const expiresAt = new Date();
    expiresAt.setUTCDate(
      expiresAt.getUTCDate() + TERMINAL_TRANSCRIPT_RETENTION_DAYS,
    );
    return expiresAt;
  }

  private schedulePendingOpenTimeout(sessionId: string): void {
    this.clearPendingOpenTimer(sessionId);
    this.pendingOpenTimers.set(
      sessionId,
      setTimeout(() => {
        void this.markFailed(
          sessionId,
          undefined,
          'Terminal session did not open before the startup timeout elapsed.',
        );
      }, TERMINAL_PENDING_OPEN_TIMEOUT_MS),
    );
  }

  private clearPendingOpenTimer(sessionId: string): void {
    const timer = this.pendingOpenTimers.get(sessionId);
    if (!timer) {
      return;
    }

    clearTimeout(timer);
    this.pendingOpenTimers.delete(sessionId);
  }

  private scheduleDetachTermination(sessionId: string): void {
    this.clearDetachTimer(sessionId);
    this.detachTimers.set(
      sessionId,
      setTimeout(() => {
        void this.handleDetachTimeout(sessionId);
      }, TERMINAL_ATTACH_GRACE_SECONDS * 1000),
    );
  }

  private clearDetachTimer(sessionId: string): void {
    const timer = this.detachTimers.get(sessionId);
    if (!timer) {
      return;
    }

    clearTimeout(timer);
    this.detachTimers.delete(sessionId);
  }

  private scheduleTerminationTimeout(sessionId: string): void {
    this.clearTerminationTimer(sessionId);
    this.terminationTimers.set(
      sessionId,
      setTimeout(() => {
        void this.handleTerminationTimeout(sessionId);
      }, TERMINAL_TERMINATION_TIMEOUT_MS),
    );
  }

  private clearTerminationTimer(sessionId: string): void {
    const timer = this.terminationTimers.get(sessionId);
    if (!timer) {
      return;
    }

    clearTimeout(timer);
    this.terminationTimers.delete(sessionId);
  }

  private async handleDetachTimeout(sessionId: string): Promise<void> {
    this.detachTimers.delete(sessionId);
    const activeCount = await this.getControllerCount(sessionId);
    if (activeCount > 0) {
      return;
    }

    const session = await this.findSessionOrFail(sessionId).catch(() => null);
    if (!session || this.isTerminal(session.status)) {
      return;
    }

    await this.appendChunk(session, {
      direction: TerminalTranscriptDirection.SYSTEM,
      payload: Buffer.from(
        'No controller reattached within the grace window; terminating session.',
        'utf8',
      ).toString('base64'),
    });

    session.status = TerminalSessionStatus.TERMINATING;
    session.closedReason = 'controller-detached-timeout';
    await this.updateSessionMetadata(session, {
      status: session.status,
      closedReason: session.closedReason,
    });
    await this.publishSessionState(session);
    this.scheduleTerminationTimeout(session.id);

    const dispatched = await this.agentRealtimeService.stopTerminalSession(
      session.nodeId,
      {
        sessionId: session.id,
        reason: 'controller-detached-timeout',
      },
    );

    if (!dispatched) {
      await this.closeSession(session, {
        status: TerminalSessionStatus.CLOSED,
        reason: `Session closed after the controller did not reattach within ${this.formatAttachGraceWindow()}.`,
        exitCode: null,
      });
    }
  }

  private async handleTerminationTimeout(sessionId: string): Promise<void> {
    this.terminationTimers.delete(sessionId);

    const session = await this.findSessionOrFail(sessionId).catch(() => null);
    if (!session || session.status !== TerminalSessionStatus.TERMINATING) {
      return;
    }

    this.logger.warn(
      `Terminal session termination timed out waiting for agent exit event: session=${session.id} node=${session.nodeId}`,
    );

    await this.closeSession(session, {
      status: TerminalSessionStatus.CLOSED,
      reason:
        session.closedReason?.trim() ||
        'Termination completed after the remote shell stopped responding to exit confirmation.',
      exitCode: null,
    });
  }

  private async incrementControllerCount(sessionId: string): Promise<number> {
    if (!this.redisService.isEnabled()) {
      const nextValue = (this.localControllerCounts.get(sessionId) ?? 0) + 1;
      this.localControllerCounts.set(sessionId, nextValue);
      return nextValue;
    }

    return this.redisService.increment(
      this.buildControllerCountKey(sessionId),
      TERMINAL_ATTACH_GRACE_SECONDS * 4,
    );
  }

  private async decrementControllerCount(sessionId: string): Promise<number> {
    if (!this.redisService.isEnabled()) {
      const nextValue = Math.max(
        0,
        (this.localControllerCounts.get(sessionId) ?? 0) - 1,
      );
      this.localControllerCounts.set(sessionId, nextValue);
      return nextValue;
    }

    const nextValue = await this.redisService.decrement(
      this.buildControllerCountKey(sessionId),
      TERMINAL_ATTACH_GRACE_SECONDS * 4,
    );

    if (nextValue < 0) {
      await this.redisService.set(
        this.buildControllerCountKey(sessionId),
        '0',
        TERMINAL_ATTACH_GRACE_SECONDS * 4,
      );
      return 0;
    }

    return nextValue;
  }

  private async getControllerCount(sessionId: string): Promise<number> {
    if (!this.redisService.isEnabled()) {
      return this.localControllerCounts.get(sessionId) ?? 0;
    }

    const rawValue = await this.redisService.get(
      this.buildControllerCountKey(sessionId),
    );
    const parsed = Number(rawValue ?? '0');
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  private buildControllerCountKey(sessionId: string): string {
    return `${TERMINAL_REDIS_KEYS.CONTROLLER_COUNT_PREFIX}${sessionId}`;
  }

  private formatAttachGraceWindow(): string {
    const seconds = Number(TERMINAL_ATTACH_GRACE_SECONDS);

    if (seconds % 60 === 0) {
      const minutes = seconds / 60;
      return `${minutes} minute${minutes === 1 ? '' : 's'}`;
    }

    return `${seconds} second${seconds === 1 ? '' : 's'}`;
  }

  private parseOptionalDate(value?: string): Date | null {
    if (!value) {
      return null;
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private readNumericReturningValue(
    raw: Record<string, unknown>,
    keys: string[],
  ): number {
    for (const key of keys) {
      const value = raw[key];
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    throw new Error(
      `Unable to read numeric returning value from terminal session chunk update (${keys.join(', ')}).`,
    );
  }

  private readDateReturningValue(
    raw: Record<string, unknown>,
    keys: string[],
  ): Date | null {
    for (const key of keys) {
      const value = raw[key];
      if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
      }

      if (typeof value === 'string' || typeof value === 'number') {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) {
          return parsed;
        }
      }
    }

    return null;
  }

  private async updateSessionMetadata(
    session: TerminalSessionEntity,
    patch: TerminalSessionMetadataPatch,
  ): Promise<TerminalSessionEntity> {
    const setClause: Record<string, unknown> = {
      updatedAt: () => 'CURRENT_TIMESTAMP',
    };

    if ('status' in patch) {
      setClause.status = patch.status ?? null;
    }
    if ('openedAt' in patch) {
      setClause.openedAt = patch.openedAt ?? null;
    }
    if ('closedAt' in patch) {
      setClause.closedAt = patch.closedAt ?? null;
    }
    if ('closedReason' in patch) {
      setClause.closedReason = patch.closedReason ?? null;
    }
    if ('exitCode' in patch) {
      setClause.exitCode = patch.exitCode ?? null;
    }
    if ('cols' in patch) {
      setClause.cols = patch.cols ?? null;
    }
    if ('rows' in patch) {
      setClause.rows = patch.rows ?? null;
    }

    const updateResult = await this.sessionsRepository
      .createQueryBuilder()
      .update(TerminalSessionEntity)
      .set(setClause as never)
      .where('id = :sessionId', { sessionId: session.id })
      .returning(['updatedAt'])
      .execute();

    const rawUpdateResult = Array.isArray(updateResult.raw)
      ? updateResult.raw[0]
      : updateResult.raw;
    const nextUpdatedAt =
      rawUpdateResult && typeof rawUpdateResult === 'object'
        ? this.readDateReturningValue(rawUpdateResult, [
            'updatedAt',
            'updatedat',
          ])
        : null;

    if ('status' in patch && patch.status !== undefined) {
      session.status = patch.status;
    }
    if ('openedAt' in patch) {
      session.openedAt = patch.openedAt ?? null;
    }
    if ('closedAt' in patch) {
      session.closedAt = patch.closedAt ?? null;
    }
    if ('closedReason' in patch) {
      session.closedReason = patch.closedReason ?? null;
    }
    if ('exitCode' in patch) {
      session.exitCode = patch.exitCode ?? null;
    }
    if ('cols' in patch && typeof patch.cols === 'number') {
      session.cols = patch.cols;
    }
    if ('rows' in patch && typeof patch.rows === 'number') {
      session.rows = patch.rows;
    }
    session.updatedAt = nextUpdatedAt ?? new Date();

    return session;
  }

  private async reconcileTranscriptState(
    session: TerminalSessionEntity,
  ): Promise<void> {
    const raw = await this.chunksRepository
      .createQueryBuilder('chunk')
      .select('COALESCE(MAX(chunk.seq), 0)', 'lastChunkSeq')
      .addSelect('COUNT(*)', 'chunkCount')
      .addSelect(
        "COALESCE(SUM(OCTET_LENGTH(DECODE(chunk.payload, 'base64'))), 0)",
        'transcriptBytes',
      )
      .where('chunk.sessionId = :sessionId', { sessionId: session.id })
      .getRawOne<Record<string, unknown>>();

    const lastChunkSeq = this.readNumericReturningValue(raw ?? {}, [
      'lastChunkSeq',
      'lastchunkseq',
    ]);
    const chunkCount = this.readNumericReturningValue(raw ?? {}, [
      'chunkCount',
      'chunkcount',
    ]);
    const transcriptBytes = this.readNumericReturningValue(raw ?? {}, [
      'transcriptBytes',
      'transcriptbytes',
    ]);

    const updateResult = await this.sessionsRepository
      .createQueryBuilder()
      .update(TerminalSessionEntity)
      .set({
        lastChunkSeq,
        chunkCount,
        transcriptBytes: String(transcriptBytes),
        updatedAt: () => 'CURRENT_TIMESTAMP',
      } as never)
      .where('id = :sessionId', { sessionId: session.id })
      .returning(['updatedAt'])
      .execute();

    const rawUpdateResult = Array.isArray(updateResult.raw)
      ? updateResult.raw[0]
      : updateResult.raw;

    session.lastChunkSeq = lastChunkSeq;
    session.chunkCount = chunkCount;
    session.transcriptBytes = String(transcriptBytes);
    session.updatedAt =
      rawUpdateResult && typeof rawUpdateResult === 'object'
        ? this.readDateReturningValue(rawUpdateResult, [
            'updatedAt',
            'updatedat',
          ]) ?? new Date()
        : new Date();
  }

  private isChunkSequenceConflict(error: unknown): boolean {
    const code =
      (error as { code?: string })?.code ??
      (error as { driverError?: { code?: string } })?.driverError?.code;
    if (code !== '23505') {
      return false;
    }

    const constraint =
      (error as { constraint?: string })?.constraint ??
      (error as { driverError?: { constraint?: string } })?.driverError
        ?.constraint;
    if (constraint === 'IDX_terminal_session_chunks_session_seq') {
      return true;
    }

    const message =
      (error as { message?: string })?.message ??
      (error as { driverError?: { message?: string } })?.driverError?.message;
    return (
      typeof message === 'string' &&
      message.includes('IDX_terminal_session_chunks_session_seq')
    );
  }

  private isTerminal(status: TerminalSessionStatus): boolean {
    return (
      status === TerminalSessionStatus.CLOSED ||
      status === TerminalSessionStatus.FAILED
    );
  }
}
