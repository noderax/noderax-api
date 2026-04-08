import { BadRequestException, Injectable } from '@nestjs/common';
import { TASK_TYPES } from '../../common/constants/task-types.constants';
import { NodesService } from '../nodes/nodes.service';
import { TasksService } from '../tasks/tasks.service';
import { TaskEntity } from '../tasks/entities/task.entity';
import { TaskStatus } from '../tasks/entities/task-status.enum';
import { CreateLogPreviewDto } from './dto/create-log-preview.dto';
import {
  type LogScanEntry,
  type LogScanTaskPayload,
  type LogScanTaskResult,
} from './log-scan.types';
import {
  LOG_SOURCE_PRESETS,
  findLogSourcePresetOrThrow,
} from './log-source-presets';

const LOG_PREVIEW_WAIT_TIMEOUT_MS = 10_000;
const LOG_PREVIEW_POLL_INTERVAL_MS = 250;
const DEFAULT_SCAN_MAX_LINES = 500;
const DEFAULT_SCAN_MAX_BYTES = 65_536;
const HARD_SCAN_MAX_LINES = 2_000;
const HARD_SCAN_MAX_BYTES = 262_144;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const clampNumber = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

@Injectable()
export class LogsService {
  constructor(
    private readonly nodesService: NodesService,
    private readonly tasksService: TasksService,
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
        payload: this.buildLogScanPayload(
          preset.id,
          dto.backfillLines ?? preset.defaultBackfillLines ?? 200,
          preset.requiresRoot,
        ),
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

  private buildLogScanPayload(
    sourcePresetId: string,
    backfillLines: number,
    runAsRoot: boolean,
  ): LogScanTaskPayload {
    return {
      mode: 'preview',
      sourcePresetId,
      runAsRoot,
      ...(runAsRoot ? { rootScope: 'operational' as const } : {}),
      limits: {
        maxLines: DEFAULT_SCAN_MAX_LINES,
        maxBytes: DEFAULT_SCAN_MAX_BYTES,
        backfillLines: clampNumber(backfillLines, 1, 500),
      },
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
      runAsRoot: task.payload.runAsRoot === true,
      rootScope:
        task.payload.rootScope === 'operational' ? 'operational' : undefined,
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

  private readPreset(sourcePresetId: string) {
    try {
      return findLogSourcePresetOrThrow(sourcePresetId);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error
          ? error.message
          : 'Unsupported log source preset.',
      );
    }
  }
}
