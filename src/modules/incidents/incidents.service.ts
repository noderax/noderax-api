import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { hostname } from 'os';
import { Repository } from 'typeorm';
import { TASK_TYPES } from '../../common/constants/task-types.constants';
import { RequestAuditContext } from '../../common/types/request-audit-context.type';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { NodesService } from '../nodes/nodes.service';
import { TasksService } from '../tasks/tasks.service';
import { TaskEntity } from '../tasks/entities/task.entity';
import { TaskStatus } from '../tasks/entities/task-status.enum';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { CreateLogMonitorRuleDto } from './dto/create-log-monitor-rule.dto';
import { CreateLogPreviewDto } from './dto/create-log-preview.dto';
import { IncidentAnalysisRequestDto } from './dto/log-preview-response.dto';
import { QueryIncidentsDto } from './dto/query-incidents.dto';
import { UpdateLogMonitorRuleDto } from './dto/update-log-monitor-rule.dto';
import { IncidentAnalysisEntity } from './entities/incident-analysis.entity';
import { IncidentEntity } from './entities/incident.entity';
import { type LogMonitorCadence } from './entities/log-monitor-cadence.enum';
import { LogMonitorCursorEntity } from './entities/log-monitor-cursor.entity';
import { LogMonitorRuleEntity } from './entities/log-monitor-rule.entity';
import {
  evaluateLogMonitorDsl,
  normalizeLogMonitorDsl,
  renderLogMonitorTemplate,
  type LogMonitorDsl,
} from './log-monitor-dsl';
import {
  type LogScanCursorState,
  type LogScanEntry,
  type LogScanTaskPayload,
  type LogScanTaskResult,
} from './log-scan.types';
import {
  LOG_SOURCE_PRESETS,
  findLogSourcePresetOrThrow,
} from './log-source-presets';

const INCIDENT_RULE_RUNNER_LEASE_MS = 30_000;
const INCIDENT_RULE_RUNNER_INTERVAL_MS = 30_000;
const LOG_PREVIEW_WAIT_TIMEOUT_MS = 10_000;
const LOG_PREVIEW_POLL_INTERVAL_MS = 250;
const DEFAULT_SCAN_MAX_LINES = 500;
const DEFAULT_SCAN_MAX_BYTES = 65_536;
const HARD_SCAN_MAX_LINES = 2_000;
const HARD_SCAN_MAX_BYTES = 262_144;

const AI_MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-5.4-mini': {
    input: 0.75,
    output: 4.5,
  },
  'gpt-5.4-nano': {
    input: 0.2,
    output: 1.25,
  },
  'gpt-5 mini': {
    input: 0.25,
    output: 2,
  },
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const clampNumber = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const extractNumber = (...candidates: unknown[]): number | null => {
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return candidate;
    }
  }

  return null;
};

@Injectable()
export class IncidentsService {
  private readonly logger = new Logger(IncidentsService.name);
  readonly runnerInstanceId = `${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;

  constructor(
    @InjectRepository(LogMonitorRuleEntity)
    private readonly logMonitorRulesRepository: Repository<LogMonitorRuleEntity>,
    @InjectRepository(LogMonitorCursorEntity)
    private readonly logMonitorCursorsRepository: Repository<LogMonitorCursorEntity>,
    @InjectRepository(IncidentEntity)
    private readonly incidentsRepository: Repository<IncidentEntity>,
    @InjectRepository(IncidentAnalysisEntity)
    private readonly incidentAnalysesRepository: Repository<IncidentAnalysisEntity>,
    private readonly nodesService: NodesService,
    @Inject(forwardRef(() => TasksService))
    private readonly tasksService: TasksService,
    private readonly workspacesService: WorkspacesService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  listPresets() {
    return LOG_SOURCE_PRESETS;
  }

  async preview(
    workspaceId: string,
    nodeId: string,
    dto: CreateLogPreviewDto,
  ): Promise<{
    statusCode: 200 | 202;
    body: {
      taskId: string;
      taskStatus: TaskStatus;
      sourcePresetId: string;
      entries: LogScanEntry[];
      truncated: boolean;
      warnings: string[];
      error: string | null;
    };
  }> {
    await this.nodesService.findOneOrFail(nodeId, workspaceId);
    const preset = this.readPreset(dto.sourcePresetId);
    const task = await this.tasksService.create(
      {
        nodeId,
        type: TASK_TYPES.LOG_SCAN,
        payload: this.buildLogScanPayload({
          mode: 'preview',
          sourcePresetId: preset.id,
          cursor: null,
          backfillLines:
            dto.backfillLines ?? preset.defaultBackfillLines ?? 200,
          ruleId: null,
          runAsRoot: preset.requiresRoot,
        }),
      },
      workspaceId,
      undefined,
      true,
    );

    const completedTask = await this.tasksService.waitForTerminalState(
      task.id,
      LOG_PREVIEW_WAIT_TIMEOUT_MS,
      LOG_PREVIEW_POLL_INTERVAL_MS,
      workspaceId,
    );

    if (!completedTask) {
      return {
        statusCode: 202,
        body: this.buildPreviewBody(task, null),
      };
    }

    return {
      statusCode: 200,
      body: this.buildPreviewBody(
        completedTask,
        this.readLogScanTaskResult(completedTask),
      ),
    };
  }

  async listRules(
    workspaceId: string,
    nodeId: string,
  ): Promise<LogMonitorRuleEntity[]> {
    await this.nodesService.findOneOrFail(nodeId, workspaceId);
    return this.logMonitorRulesRepository.find({
      where: { workspaceId, nodeId },
      order: { createdAt: 'DESC' },
    });
  }

  async createRule(
    workspaceId: string,
    nodeId: string,
    dto: CreateLogMonitorRuleDto,
    context?: RequestAuditContext,
  ): Promise<LogMonitorRuleEntity> {
    await this.nodesService.findOneOrFail(nodeId, workspaceId);
    await this.workspacesService.assertWorkspaceWritable(workspaceId);
    const normalized = this.normalizeRuleInput(dto);

    const saved = await this.logMonitorRulesRepository.save(
      this.logMonitorRulesRepository.create({
        workspaceId,
        nodeId,
        name: normalized.name,
        enabled: normalized.enabled,
        sourcePresetId: normalized.sourcePresetId,
        cadence: normalized.cadence,
        intervalMinutes: normalized.intervalMinutes,
        dsl: normalized.dsl as Record<string, unknown>,
        nextRunAt: normalized.enabled
          ? this.computeNextRunAt(normalized.intervalMinutes, new Date())
          : null,
        lastRunAt: null,
        lastError: null,
        lastTaskId: null,
        leaseUntil: null,
        claimedBy: null,
        claimToken: null,
      }),
    );

    if (context) {
      await this.auditLogsService.record({
        scope: 'workspace',
        workspaceId,
        action: 'log-monitor-rule.created',
        targetType: 'log_monitor_rule',
        targetId: saved.id,
        targetLabel: saved.name,
        metadata: {
          nodeId,
          sourcePresetId: saved.sourcePresetId,
          intervalMinutes: saved.intervalMinutes,
        },
        context,
      });
    }

    return saved;
  }

  async updateRule(
    workspaceId: string,
    nodeId: string,
    ruleId: string,
    dto: UpdateLogMonitorRuleDto,
    context?: RequestAuditContext,
  ): Promise<LogMonitorRuleEntity> {
    const rule = await this.findRuleOrFail(ruleId, workspaceId, nodeId);
    await this.workspacesService.assertWorkspaceWritable(workspaceId);

    const normalized = this.normalizeRuleInput({
      ...rule,
      ...dto,
      dsl: dto.dsl ?? rule.dsl,
    });

    rule.name = normalized.name;
    rule.enabled = normalized.enabled;
    rule.sourcePresetId = normalized.sourcePresetId;
    rule.cadence = normalized.cadence;
    rule.intervalMinutes = normalized.intervalMinutes;
    rule.dsl = normalized.dsl as Record<string, unknown>;
    rule.nextRunAt = normalized.enabled
      ? this.computeNextRunAt(normalized.intervalMinutes, new Date())
      : null;
    rule.lastError = null;
    rule.leaseUntil = null;
    rule.claimedBy = null;
    rule.claimToken = null;

    const saved = await this.logMonitorRulesRepository.save(rule);

    if (context) {
      await this.auditLogsService.record({
        scope: 'workspace',
        workspaceId,
        action: 'log-monitor-rule.updated',
        targetType: 'log_monitor_rule',
        targetId: saved.id,
        targetLabel: saved.name,
        metadata: {
          nodeId,
          sourcePresetId: saved.sourcePresetId,
          intervalMinutes: saved.intervalMinutes,
        },
        context,
      });
    }

    return saved;
  }

  async deleteRule(
    workspaceId: string,
    nodeId: string,
    ruleId: string,
    context?: RequestAuditContext,
  ): Promise<{ deleted: true; id: string }> {
    const rule = await this.findRuleOrFail(ruleId, workspaceId, nodeId);
    await this.workspacesService.assertWorkspaceWritable(workspaceId);

    await this.logMonitorRulesRepository.remove(rule);
    await this.logMonitorCursorsRepository.delete({ ruleId: rule.id });

    if (context) {
      await this.auditLogsService.record({
        scope: 'workspace',
        workspaceId,
        action: 'log-monitor-rule.deleted',
        targetType: 'log_monitor_rule',
        targetId: rule.id,
        targetLabel: rule.name,
        metadata: {
          nodeId,
          sourcePresetId: rule.sourcePresetId,
        },
        context,
      });
    }

    return {
      deleted: true,
      id: rule.id,
    };
  }

  async listIncidents(
    workspaceId: string,
    query: QueryIncidentsDto,
  ): Promise<IncidentEntity[]> {
    const incidentsQuery = this.incidentsRepository
      .createQueryBuilder('incident')
      .where('incident.workspaceId = :workspaceId', { workspaceId })
      .orderBy('incident.lastSeenAt', 'DESC')
      .take(query.limit ?? 50)
      .skip(query.offset ?? 0);

    if (query.status) {
      incidentsQuery.andWhere('incident.status = :status', {
        status: query.status,
      });
    }

    if (query.severity) {
      incidentsQuery.andWhere('incident.severity = :severity', {
        severity: query.severity,
      });
    }

    if (query.nodeId) {
      incidentsQuery.andWhere('incident.nodeId = :nodeId', {
        nodeId: query.nodeId,
      });
    }

    if (query.ruleId) {
      incidentsQuery.andWhere('incident.ruleId = :ruleId', {
        ruleId: query.ruleId,
      });
    }

    if (query.sourcePresetId) {
      incidentsQuery.andWhere('incident.sourcePresetId = :sourcePresetId', {
        sourcePresetId: query.sourcePresetId,
      });
    }

    return this.decorateLatestAnalysis(await incidentsQuery.getMany());
  }

  async acknowledgeIncident(
    workspaceId: string,
    incidentId: string,
  ): Promise<IncidentEntity> {
    const incident = await this.findIncidentOrFail(incidentId, workspaceId);
    if (incident.status === 'resolved') {
      throw new ConflictException(
        `Incident ${incident.id} is already resolved and cannot be acknowledged.`,
      );
    }

    incident.status = 'acknowledged';
    return this.incidentsRepository.save(incident);
  }

  async resolveIncident(
    workspaceId: string,
    incidentId: string,
  ): Promise<IncidentEntity> {
    const incident = await this.findIncidentOrFail(incidentId, workspaceId);
    incident.status = 'resolved';
    return this.incidentsRepository.save(incident);
  }

  async analyzeIncident(
    workspaceId: string,
    incidentId: string,
    dto: IncidentAnalysisRequestDto,
  ): Promise<IncidentAnalysisEntity> {
    const incident = await this.findIncidentOrFail(incidentId, workspaceId);
    const model =
      dto.model?.trim() ||
      process.env.OPENAI_LOG_ANALYSIS_MODEL ||
      'gpt-5.4-mini';
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'OPENAI_API_KEY is not configured for manual incident analysis.',
      );
    }

    const baseUrl =
      process.env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1';
    const promptInput = this.buildIncidentAnalysisInput(incident);

    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        reasoning: {
          effort: 'low',
        },
        input: [
          {
            role: 'developer',
            content: [
              {
                type: 'input_text',
                text: [
                  'You analyze Linux operational incidents.',
                  'Return strict JSON with keys: summary, probableCauses, recommendedChecks.',
                  'probableCauses and recommendedChecks must be arrays of strings.',
                  'Do not include markdown fences.',
                ].join(' '),
              },
            ],
          },
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: promptInput,
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new ServiceUnavailableException(
        `OpenAI analysis request failed: ${response.status} ${errorText}`,
      );
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const outputText = this.readOpenAiOutputText(payload);
    const normalized = this.normalizeIncidentAnalysisOutput(outputText);
    const usage = isRecord(payload.usage) ? payload.usage : {};
    const inputTokens = extractNumber(
      usage.input_tokens,
      usage.prompt_tokens,
      usage.inputTokens,
    );
    const outputTokens = extractNumber(
      usage.output_tokens,
      usage.completion_tokens,
      usage.outputTokens,
    );

    const saved = await this.incidentAnalysesRepository.save(
      this.incidentAnalysesRepository.create({
        incidentId: incident.id,
        model,
        summary: normalized.summary,
        probableCauses: normalized.probableCauses,
        recommendedChecks: normalized.recommendedChecks,
        inputTokens,
        outputTokens,
        estimatedCostUsd: this.formatEstimatedCost(
          model,
          inputTokens,
          outputTokens,
        ),
      }),
    );

    return saved;
  }

  async claimNextDueRule(
    claimedBy: string,
  ): Promise<LogMonitorRuleEntity | null> {
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + INCIDENT_RULE_RUNNER_LEASE_MS);

    while (true) {
      const candidate = await this.logMonitorRulesRepository
        .createQueryBuilder('rule')
        .select('rule.id', 'id')
        .where('rule.enabled = true')
        .andWhere('rule.nextRunAt IS NOT NULL')
        .andWhere('rule.nextRunAt <= :now', { now })
        .andWhere('(rule.leaseUntil IS NULL OR rule.leaseUntil <= :now)', {
          now,
        })
        .orderBy('rule.nextRunAt', 'ASC')
        .addOrderBy('rule.createdAt', 'ASC')
        .limit(1)
        .getRawOne<{ id: string }>();

      if (!candidate?.id) {
        return null;
      }

      const claimToken = randomUUID();
      const updateResult = await this.logMonitorRulesRepository
        .createQueryBuilder()
        .update(LogMonitorRuleEntity)
        .set({
          claimedBy,
          claimToken,
          leaseUntil,
          updatedAt: now,
        })
        .where('id = :id', { id: candidate.id })
        .andWhere('enabled = true')
        .andWhere('nextRunAt IS NOT NULL')
        .andWhere('nextRunAt <= :now', { now })
        .andWhere('(leaseUntil IS NULL OR leaseUntil <= :now)', { now })
        .returning('*')
        .execute();

      if ((updateResult.affected ?? 0) === 0) {
        continue;
      }

      const row = updateResult.raw?.[0] as LogMonitorRuleEntity | undefined;
      if (row?.id) {
        return row;
      }

      return this.logMonitorRulesRepository.findOne({ where: { claimToken } });
    }
  }

  async triggerClaimedRule(
    rule: LogMonitorRuleEntity,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      const preset = this.readPreset(rule.sourcePresetId);
      await this.nodesService.findOneOrFail(rule.nodeId, rule.workspaceId);
      const cursor = await this.logMonitorCursorsRepository.findOne({
        where: { ruleId: rule.id },
      });
      const task = await this.tasksService.create(
        {
          nodeId: rule.nodeId,
          type: TASK_TYPES.LOG_SCAN,
          payload: this.buildLogScanPayload({
            mode: 'monitor',
            sourcePresetId: rule.sourcePresetId,
            cursor: this.serializeCursor(cursor),
            backfillLines: preset.defaultBackfillLines,
            ruleId: rule.id,
            runAsRoot: preset.requiresRoot,
          }),
        },
        rule.workspaceId,
        undefined,
        true,
      );

      await this.logMonitorRulesRepository.update(
        { id: rule.id, claimToken: rule.claimToken },
        {
          lastTaskId: task.id,
          lastError: null,
          nextRunAt: this.computeNextRunAt(rule.intervalMinutes, new Date()),
          leaseUntil: null,
          claimedBy: null,
          claimToken: null,
        },
      );

      return { ok: true };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown log monitor error';

      this.logger.warn(
        `Log monitor rule ${rule.id} failed to queue log.scan task: ${message}`,
      );

      await this.logMonitorRulesRepository.update(
        { id: rule.id, claimToken: rule.claimToken },
        {
          lastError: message,
          leaseUntil: null,
          claimedBy: null,
          claimToken: null,
        },
      );

      return {
        ok: false,
        error: message,
      };
    }
  }

  async processLogScanTask(task: TaskEntity): Promise<void> {
    if (task.type !== TASK_TYPES.LOG_SCAN) {
      return;
    }

    const payload = this.readLogScanTaskPayload(task);
    if (!payload || payload.mode !== 'monitor') {
      return;
    }

    const ruleId = payload.internalContext?.ruleId;
    if (!ruleId) {
      return;
    }

    const rule = await this.logMonitorRulesRepository.findOne({
      where: { id: ruleId },
    });
    if (!rule) {
      return;
    }

    if (task.status !== TaskStatus.SUCCESS) {
      await this.logMonitorRulesRepository.update(
        { id: rule.id },
        {
          lastRunAt: new Date(),
          lastTaskId: task.id,
          lastError:
            task.output?.trim() || `log.scan task ended with ${task.status}`,
        },
      );
      return;
    }

    const result = this.readLogScanTaskResult(task);
    if (!result) {
      await this.logMonitorRulesRepository.update(
        { id: rule.id },
        {
          lastRunAt: new Date(),
          lastTaskId: task.id,
          lastError: 'log.scan completed without a structured result.',
        },
      );
      return;
    }

    const dsl = normalizeLogMonitorDsl(rule.dsl);
    const evaluation = evaluateLogMonitorDsl(dsl, result.entries);

    await this.upsertCursor(rule, result.cursor);

    await this.logMonitorRulesRepository.update(
      { id: rule.id },
      {
        lastRunAt: new Date(),
        lastTaskId: task.id,
        lastError: null,
      },
    );

    if (!evaluation.matched) {
      return;
    }

    const sampleEntries = evaluation.matches.slice(
      0,
      dsl.incident.captureLines,
    );
    const firstMatch = sampleEntries[0] ?? null;
    const renderedTitle = renderLogMonitorTemplate(
      dsl.incident.titleTemplate,
      firstMatch,
      rule.sourcePresetId,
    );
    const renderedFingerprint = renderLogMonitorTemplate(
      dsl.incident.fingerprintTemplate,
      firstMatch,
      rule.sourcePresetId,
    );

    const existing = await this.incidentsRepository.findOne({
      where: {
        workspaceId: rule.workspaceId,
        nodeId: rule.nodeId,
        ruleId: rule.id,
        fingerprint: renderedFingerprint,
      },
      order: {
        createdAt: 'DESC',
      },
    });

    const now = new Date();
    if (
      existing &&
      (existing.status === 'open' || existing.status === 'acknowledged')
    ) {
      existing.lastSeenAt = now;
      existing.hitCount += evaluation.matches.length;
      existing.latestSample = {
        entries: sampleEntries,
        warnings: result.warnings,
        truncated: result.truncated,
      };
      existing.latestTaskId = task.id;
      existing.severity = dsl.incident.severity;
      existing.title = renderedTitle;
      await this.incidentsRepository.save(existing);
      return;
    }

    await this.incidentsRepository.save(
      this.incidentsRepository.create({
        workspaceId: rule.workspaceId,
        nodeId: rule.nodeId,
        ruleId: rule.id,
        sourcePresetId: rule.sourcePresetId,
        status: 'open',
        severity: dsl.incident.severity,
        title: renderedTitle,
        fingerprint: renderedFingerprint,
        firstSeenAt: now,
        lastSeenAt: now,
        hitCount: evaluation.matches.length,
        latestSample: {
          entries: sampleEntries,
          warnings: result.warnings,
          truncated: result.truncated,
        },
        latestTaskId: task.id,
      }),
    );
  }

  private normalizeRuleInput(input: {
    name: string;
    sourcePresetId: string;
    cadence?: string | null;
    intervalMinutes?: number | null;
    enabled?: boolean | null;
    dsl: Record<string, unknown>;
  }): {
    name: string;
    sourcePresetId: string;
    enabled: boolean;
    cadence: LogMonitorCadence;
    intervalMinutes: number;
    dsl: LogMonitorDsl;
  } {
    const preset = this.readPreset(input.sourcePresetId);
    const name = input.name.trim();
    const intervalMinutes = clampNumber(
      Number.isInteger(input.intervalMinutes)
        ? Number(input.intervalMinutes)
        : 1,
      1,
      60,
    );
    const cadence: LogMonitorCadence =
      input.cadence === 'custom' || intervalMinutes > 1 ? 'custom' : 'minutely';

    return {
      name,
      sourcePresetId: preset.id,
      enabled: input.enabled !== false,
      cadence,
      intervalMinutes,
      dsl: normalizeLogMonitorDsl(input.dsl),
    };
  }

  private readPreset(sourcePresetId: string) {
    try {
      return findLogSourcePresetOrThrow(sourcePresetId);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private computeNextRunAt(intervalMinutes: number, from: Date): Date {
    const next = new Date(from);
    next.setUTCSeconds(0, 0);
    next.setUTCMinutes(next.getUTCMinutes() + Math.max(1, intervalMinutes));
    return next;
  }

  private buildLogScanPayload(input: {
    mode: 'preview' | 'monitor';
    sourcePresetId: string;
    cursor: LogScanCursorState | null;
    backfillLines: number;
    ruleId: string | null;
    runAsRoot: boolean;
  }): LogScanTaskPayload {
    return {
      mode: input.mode,
      sourcePresetId: input.sourcePresetId,
      runAsRoot: input.runAsRoot,
      rootScope: input.runAsRoot ? 'operational' : undefined,
      cursor: input.cursor ?? undefined,
      limits: {
        maxLines: DEFAULT_SCAN_MAX_LINES,
        maxBytes: DEFAULT_SCAN_MAX_BYTES,
        backfillLines: clampNumber(input.backfillLines, 1, 500),
      },
      internalContext: input.ruleId ? { ruleId: input.ruleId } : undefined,
    };
  }

  private buildPreviewBody(
    task: TaskEntity,
    result: LogScanTaskResult | null,
  ): {
    taskId: string;
    taskStatus: TaskStatus;
    sourcePresetId: string;
    entries: LogScanEntry[];
    truncated: boolean;
    warnings: string[];
    error: string | null;
  } {
    const payload = this.readLogScanTaskPayload(task);

    return {
      taskId: task.id,
      taskStatus: task.status,
      sourcePresetId: payload?.sourcePresetId ?? 'unknown',
      entries: result?.entries ?? [],
      truncated: result?.truncated ?? false,
      warnings: result?.warnings ?? [],
      error:
        task.status === TaskStatus.SUCCESS
          ? null
          : task.output?.trim() || `Task finished with status ${task.status}.`,
    };
  }

  private readLogScanTaskPayload(
    task: Pick<TaskEntity, 'type' | 'payload'>,
  ): LogScanTaskPayload | null {
    if (task.type !== TASK_TYPES.LOG_SCAN || !isRecord(task.payload)) {
      return null;
    }

    const mode =
      task.payload.mode === 'preview' || task.payload.mode === 'monitor'
        ? task.payload.mode
        : null;
    const sourcePresetId =
      typeof task.payload.sourcePresetId === 'string'
        ? task.payload.sourcePresetId
        : null;

    if (!mode || !sourcePresetId) {
      return null;
    }

    return {
      mode,
      sourcePresetId,
      limits: isRecord(task.payload.limits)
        ? {
            maxLines:
              typeof task.payload.limits.maxLines === 'number'
                ? clampNumber(
                    task.payload.limits.maxLines,
                    1,
                    HARD_SCAN_MAX_LINES,
                  )
                : undefined,
            maxBytes:
              typeof task.payload.limits.maxBytes === 'number'
                ? clampNumber(
                    task.payload.limits.maxBytes,
                    1,
                    HARD_SCAN_MAX_BYTES,
                  )
                : undefined,
            backfillLines:
              typeof task.payload.limits.backfillLines === 'number'
                ? clampNumber(task.payload.limits.backfillLines, 1, 500)
                : undefined,
          }
        : undefined,
      cursor: isRecord(task.payload.cursor)
        ? {
            journalCursor:
              typeof task.payload.cursor.journalCursor === 'string'
                ? task.payload.cursor.journalCursor
                : null,
            fileInode:
              typeof task.payload.cursor.fileInode === 'string'
                ? task.payload.cursor.fileInode
                : null,
            fileOffset:
              typeof task.payload.cursor.fileOffset === 'number'
                ? task.payload.cursor.fileOffset
                : null,
            lastReadAt:
              typeof task.payload.cursor.lastReadAt === 'string'
                ? task.payload.cursor.lastReadAt
                : null,
            cursorResetReason:
              typeof task.payload.cursor.cursorResetReason === 'string'
                ? task.payload.cursor.cursorResetReason
                : null,
          }
        : undefined,
      runAsRoot: task.payload.runAsRoot === true,
      rootScope:
        task.payload.rootScope === 'operational' ||
        task.payload.rootScope === 'task'
          ? 'operational'
          : undefined,
      internalContext: isRecord(task.payload.internalContext)
        ? {
            ruleId:
              typeof task.payload.internalContext.ruleId === 'string'
                ? task.payload.internalContext.ruleId
                : undefined,
          }
        : undefined,
    };
  }

  private readLogScanTaskResult(
    task: Pick<TaskEntity, 'result'>,
  ): LogScanTaskResult | null {
    if (!isRecord(task.result)) {
      return null;
    }

    const entries = Array.isArray(task.result.entries)
      ? task.result.entries
          .filter(
            (entry) => isRecord(entry) && typeof entry.message === 'string',
          )
          .map(
            (entry) =>
              ({
                timestamp:
                  typeof entry.timestamp === 'string' ? entry.timestamp : null,
                message: entry.message,
                unit: typeof entry.unit === 'string' ? entry.unit : null,
                identifier:
                  typeof entry.identifier === 'string'
                    ? entry.identifier
                    : null,
              }) satisfies LogScanEntry,
          )
      : [];

    return {
      sourcePresetId:
        typeof task.result.sourcePresetId === 'string'
          ? task.result.sourcePresetId
          : 'unknown',
      sourceType: task.result.sourceType === 'journal' ? 'journal' : 'file',
      entries,
      cursor: isRecord(task.result.cursor)
        ? {
            journalCursor:
              typeof task.result.cursor.journalCursor === 'string'
                ? task.result.cursor.journalCursor
                : null,
            fileInode:
              typeof task.result.cursor.fileInode === 'string'
                ? task.result.cursor.fileInode
                : null,
            fileOffset:
              typeof task.result.cursor.fileOffset === 'number'
                ? task.result.cursor.fileOffset
                : null,
            lastReadAt:
              typeof task.result.cursor.lastReadAt === 'string'
                ? task.result.cursor.lastReadAt
                : null,
            cursorResetReason:
              typeof task.result.cursor.cursorResetReason === 'string'
                ? task.result.cursor.cursorResetReason
                : null,
          }
        : {},
      truncated: task.result.truncated === true,
      bytesRead:
        typeof task.result.bytesRead === 'number' ? task.result.bytesRead : 0,
      linesRead:
        typeof task.result.linesRead === 'number' ? task.result.linesRead : 0,
      warnings: Array.isArray(task.result.warnings)
        ? task.result.warnings.filter(
            (warning): warning is string => typeof warning === 'string',
          )
        : [],
    };
  }

  private async upsertCursor(
    rule: LogMonitorRuleEntity,
    cursor: LogScanCursorState,
  ): Promise<void> {
    const existing = await this.logMonitorCursorsRepository.findOne({
      where: { ruleId: rule.id },
    });

    const entity =
      existing ??
      this.logMonitorCursorsRepository.create({
        ruleId: rule.id,
        nodeId: rule.nodeId,
        sourcePresetId: rule.sourcePresetId,
      });

    entity.journalCursor = cursor.journalCursor ?? null;
    entity.fileInode = cursor.fileInode ?? null;
    entity.fileOffset =
      typeof cursor.fileOffset === 'number' ? String(cursor.fileOffset) : null;
    entity.lastReadAt = cursor.lastReadAt ? new Date(cursor.lastReadAt) : null;
    entity.cursorResetReason = cursor.cursorResetReason ?? null;

    await this.logMonitorCursorsRepository.save(entity);
  }

  private serializeCursor(
    cursor: LogMonitorCursorEntity | null,
  ): LogScanCursorState | null {
    if (!cursor) {
      return null;
    }

    return {
      journalCursor: cursor.journalCursor,
      fileInode: cursor.fileInode,
      fileOffset: cursor.fileOffset ? Number(cursor.fileOffset) : null,
      lastReadAt: cursor.lastReadAt?.toISOString() ?? null,
      cursorResetReason: cursor.cursorResetReason,
    };
  }

  private async findRuleOrFail(
    ruleId: string,
    workspaceId: string,
    nodeId: string,
  ): Promise<LogMonitorRuleEntity> {
    const rule = await this.logMonitorRulesRepository.findOne({
      where: { id: ruleId, workspaceId, nodeId },
    });

    if (!rule) {
      throw new NotFoundException(`Log monitor rule ${ruleId} was not found.`);
    }

    return rule;
  }

  private async findIncidentOrFail(
    incidentId: string,
    workspaceId: string,
  ): Promise<IncidentEntity> {
    const incident = await this.incidentsRepository.findOne({
      where: { id: incidentId, workspaceId },
    });

    if (!incident) {
      throw new NotFoundException(`Incident ${incidentId} was not found.`);
    }

    return incident;
  }

  private async decorateLatestAnalysis(
    incidents: IncidentEntity[],
  ): Promise<IncidentEntity[]> {
    if (incidents.length === 0) {
      return incidents;
    }

    const incidentIds = incidents.map((incident) => incident.id);
    const analyses = await this.incidentAnalysesRepository
      .createQueryBuilder('analysis')
      .where('analysis.incidentId IN (:...incidentIds)', { incidentIds })
      .orderBy('analysis.createdAt', 'DESC')
      .getMany();

    const latestByIncidentId = new Map<string, IncidentAnalysisEntity>();
    analyses.forEach((analysis) => {
      if (!latestByIncidentId.has(analysis.incidentId)) {
        latestByIncidentId.set(analysis.incidentId, analysis);
      }
    });

    incidents.forEach((incident) => {
      incident.latestAnalysis = latestByIncidentId.get(incident.id) ?? null;
    });

    return incidents;
  }

  private buildIncidentAnalysisInput(incident: IncidentEntity): string {
    const sample = isRecord(incident.latestSample) ? incident.latestSample : {};
    const entries = Array.isArray(sample.entries)
      ? sample.entries
          .filter(
            (entry): entry is LogScanEntry =>
              isRecord(entry) && typeof entry.message === 'string',
          )
          .slice(0, 200)
      : [];

    const redactedLines = this.redactSensitiveText(
      entries
        .map((entry) => {
          const timestamp = entry.timestamp ? `[${entry.timestamp}] ` : '';
          const unit = entry.unit ? ` unit=${entry.unit}` : '';
          const identifier = entry.identifier
            ? ` identifier=${entry.identifier}`
            : '';
          return `${timestamp}${entry.message}${unit}${identifier}`;
        })
        .join('\n')
        .slice(0, 48 * 1024),
    );

    return [
      `Incident title: ${incident.title}`,
      `Severity: ${incident.severity}`,
      `Source preset: ${incident.sourcePresetId}`,
      `Status: ${incident.status}`,
      `Hit count: ${incident.hitCount}`,
      `First seen: ${incident.firstSeenAt.toISOString()}`,
      `Last seen: ${incident.lastSeenAt.toISOString()}`,
      '',
      'Redacted sample lines:',
      redactedLines,
    ].join('\n');
  }

  private redactSensitiveText(input: string): string {
    return input
      .replaceAll(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer [REDACTED]')
      .replaceAll(
        /\b(password|passwd|pwd)\s*[:=]\s*["']?[^"'\s]+["']?/gi,
        '$1=[REDACTED]',
      )
      .replaceAll(/\b(cookie|set-cookie)\s*[:=]\s*[^;\n]+/gi, '$1=[REDACTED]')
      .replaceAll(
        /\b(api[_-]?key|token|secret)\s*[:=]\s*["']?[^"'\s]+["']?/gi,
        '$1=[REDACTED]',
      );
  }

  private readOpenAiOutputText(payload: Record<string, unknown>): string {
    if (typeof payload.output_text === 'string' && payload.output_text.trim()) {
      return payload.output_text;
    }

    const output = Array.isArray(payload.output) ? payload.output : [];
    const fragments: string[] = [];

    output.forEach((item) => {
      if (!isRecord(item) || item.type !== 'message') {
        return;
      }

      const content = Array.isArray(item.content) ? item.content : [];
      content.forEach((part) => {
        if (isRecord(part) && typeof part.text === 'string') {
          fragments.push(part.text);
        }
      });
    });

    const joined = fragments.join('\n').trim();
    if (!joined) {
      throw new ServiceUnavailableException(
        'OpenAI response did not contain output_text.',
      );
    }

    return joined;
  }

  private normalizeIncidentAnalysisOutput(text: string): {
    summary: string;
    probableCauses: string[];
    recommendedChecks: string[];
  } {
    const trimmed = text.trim();
    const jsonStart = trimmed.indexOf('{');
    const jsonEnd = trimmed.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1 || jsonEnd < jsonStart) {
      throw new ServiceUnavailableException(
        'OpenAI response did not return valid JSON content.',
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1));
    } catch (error) {
      throw new ServiceUnavailableException(
        `OpenAI response JSON could not be parsed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    if (!isRecord(parsed) || typeof parsed.summary !== 'string') {
      throw new ServiceUnavailableException(
        'OpenAI response JSON is missing summary.',
      );
    }

    const probableCauses = Array.isArray(parsed.probableCauses)
      ? parsed.probableCauses.filter(
          (value): value is string =>
            typeof value === 'string' && value.trim().length > 0,
        )
      : [];
    const recommendedChecks = Array.isArray(parsed.recommendedChecks)
      ? parsed.recommendedChecks.filter(
          (value): value is string =>
            typeof value === 'string' && value.trim().length > 0,
        )
      : [];

    return {
      summary: parsed.summary.trim(),
      probableCauses,
      recommendedChecks,
    };
  }

  private formatEstimatedCost(
    model: string,
    inputTokens: number | null,
    outputTokens: number | null,
  ): string | null {
    if (inputTokens === null || outputTokens === null) {
      return null;
    }

    const pricing =
      AI_MODEL_PRICING[model] ?? AI_MODEL_PRICING[model.toLowerCase()] ?? null;
    if (!pricing) {
      return null;
    }

    const estimated =
      (inputTokens / 1_000_000) * pricing.input +
      (outputTokens / 1_000_000) * pricing.output;

    return estimated.toFixed(6);
  }
}

export {
  INCIDENT_RULE_RUNNER_INTERVAL_MS,
  INCIDENT_RULE_RUNNER_LEASE_MS,
  DEFAULT_SCAN_MAX_BYTES,
  DEFAULT_SCAN_MAX_LINES,
  HARD_SCAN_MAX_BYTES,
  HARD_SCAN_MAX_LINES,
};
