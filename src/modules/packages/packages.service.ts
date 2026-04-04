import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  PackageMutationTaskType,
  TASK_TYPES,
} from '../../common/constants/task-types.constants';
import { TaskStatus } from '../tasks/entities/task-status.enum';
import { TaskEntity } from '../tasks/entities/task.entity';
import { TasksService } from '../tasks/tasks.service';
import { NormalizedPackageTaskResult } from '../tasks/types/package-task-result.type';
import { InstallPackagesDto } from './dto/install-packages.dto';
import { ListPackagesResponseDto } from './dto/list-packages-response.dto';
import { PackageTaskAcceptedDto } from './dto/package-task-accepted.dto';
import { QueryPackageRemovalDto } from './dto/query-package-removal.dto';
import { QueryPackageSearchDto } from './dto/query-package-search.dto';
import { SearchPackagesResponseDto } from './dto/search-packages-response.dto';

const PACKAGE_WAIT_TIMEOUT_MS = 10000;
const PACKAGE_WAIT_POLL_INTERVAL_MS = 250;
const PACKAGE_RECENT_TASK_SCAN_LIMIT = 50;

type PackageReadResponse =
  | ListPackagesResponseDto
  | SearchPackagesResponseDto
  | PackageTaskAcceptedDto;

export interface PackageHttpResponse<T extends PackageReadResponse> {
  statusCode: HttpStatus.OK | HttpStatus.ACCEPTED;
  body: T;
}

@Injectable()
export class PackagesService {
  private readonly logger = new Logger(PackagesService.name);

  constructor(private readonly tasksService: TasksService) {}

  async listInstalled(
    nodeId: string,
    workspaceId?: string,
  ): Promise<
    PackageHttpResponse<ListPackagesResponseDto | PackageTaskAcceptedDto>
  > {
    const task = await this.getOrCreatePackageListTask(nodeId, workspaceId);

    return this.resolveReadTask(task.id, {
      nodeId,
      operation: TASK_TYPES.PACKAGE_LIST,
      term: null,
    });
  }

  async search(
    query: QueryPackageSearchDto,
    workspaceId?: string,
  ): Promise<
    PackageHttpResponse<SearchPackagesResponseDto | PackageTaskAcceptedDto>
  > {
    const task = await this.tasksService.create(
      {
        nodeId: query.nodeId,
        type: TASK_TYPES.PACKAGE_SEARCH,
        payload: {
          term: query.term,
          query: query.term,
        },
      },
      workspaceId,
    );

    return this.resolveReadTask(task.id, {
      nodeId: query.nodeId,
      operation: TASK_TYPES.PACKAGE_SEARCH,
      term: query.term,
    });
  }

  async install(
    nodeId: string,
    installPackagesDto: InstallPackagesDto,
    workspaceId?: string,
  ): Promise<PackageTaskAcceptedDto> {
    const names = installPackagesDto.names;
    const purge = installPackagesDto.purge ?? false;
    const task = await this.tasksService.create(
      {
        nodeId,
        type: TASK_TYPES.PACKAGE_INSTALL,
        payload: {
          names,
          packages: names,
          package: names.length === 1 ? names[0] : undefined,
          purge,
        },
      },
      workspaceId,
    );

    return this.buildAcceptedResponse(task.id, {
      nodeId,
      operation: TASK_TYPES.PACKAGE_INSTALL,
      names,
      purge,
      term: null,
    });
  }

  async remove(
    nodeId: string,
    name: string,
    query: QueryPackageRemovalDto,
    workspaceId?: string,
  ): Promise<PackageTaskAcceptedDto> {
    const purge = this.normalizeBoolean(
      query.purge as boolean | string | null | undefined,
    );
    const operation = purge
      ? TASK_TYPES.PACKAGE_PURGE
      : TASK_TYPES.PACKAGE_REMOVE;
    const task = await this.tasksService.create(
      {
        nodeId,
        type: operation,
        payload: {
          names: [name],
          packages: [name],
          package: name,
          purge,
        },
      },
      workspaceId,
    );

    return this.buildAcceptedResponse(task.id, {
      nodeId,
      operation,
      names: [name],
      purge,
      term: null,
    });
  }

  private async resolveReadTask(
    taskId: string,
    input: {
      nodeId: string;
      operation:
        | typeof TASK_TYPES.PACKAGE_LIST
        | typeof TASK_TYPES.PACKAGE_SEARCH;
      term: string | null;
    },
  ): Promise<
    PackageHttpResponse<
      | ListPackagesResponseDto
      | SearchPackagesResponseDto
      | PackageTaskAcceptedDto
    >
  > {
    const completedTask = await this.tasksService.waitForTerminalState(
      taskId,
      PACKAGE_WAIT_TIMEOUT_MS,
      PACKAGE_WAIT_POLL_INTERVAL_MS,
    );

    if (!completedTask) {
      if (input.operation === TASK_TYPES.PACKAGE_LIST) {
        const staleSuccess = await this.findLatestSuccessfulPackageListTask(
          input.nodeId,
        );
        if (staleSuccess) {
          this.logger.warn(
            JSON.stringify({
              msg: 'packages.list.timeout-using-stale-success',
              requestedTaskId: taskId,
              staleTaskId: staleSuccess.id,
            }),
          );

          const normalized =
            this.tasksService.handlePackageResult(staleSuccess);
          return {
            statusCode: HttpStatus.OK,
            body: this.buildListResponse(staleSuccess, normalized),
          };
        }
      }

      return {
        statusCode: HttpStatus.ACCEPTED,
        body: await this.buildAcceptedResponse(taskId, {
          nodeId: input.nodeId,
          operation: input.operation,
          names: [],
          purge: null,
          term: input.term,
        }),
      };
    }

    const normalized = this.tasksService.handlePackageResult(completedTask);

    if (input.operation === TASK_TYPES.PACKAGE_LIST) {
      return {
        statusCode: HttpStatus.OK,
        body: this.buildListResponse(completedTask, normalized),
      };
    }

    return {
      statusCode: HttpStatus.OK,
      body: this.buildSearchResponse(completedTask, input.term, normalized),
    };
  }

  private buildListResponse(
    task: TaskEntity,
    normalized: NormalizedPackageTaskResult | null,
  ): ListPackagesResponseDto {
    const base = this.createAcceptedDto({
      taskId: task.id,
      taskStatus: task.status,
      nodeId: task.nodeId,
      operation: TASK_TYPES.PACKAGE_LIST,
      names: [],
      purge: null,
      term: null,
    });

    if (
      task.status === TaskStatus.SUCCESS &&
      normalized?.operation === TASK_TYPES.PACKAGE_LIST
    ) {
      this.logger.debug(
        JSON.stringify({
          msg: 'packages.list.structured-result',
          taskId: task.id,
          structuredFound: true,
          fallbackUsed: false,
          parsedCount: normalized.packages.length,
        }),
      );

      return {
        ...base,
        packages: normalized.packages,
        error: null,
      };
    }

    if (task.status === TaskStatus.SUCCESS) {
      const fallback = this.parseInstalledPackagesWithFallbackSources(
        task.output,
        task.result,
      );
      if (fallback.packages.length > 0) {
        this.logger.warn(
          JSON.stringify({
            msg: 'packages.list.output-fallback-used',
            taskId: task.id,
            structuredFound: false,
            fallbackUsed: true,
            fallbackSource: fallback.source,
            parsedCount: fallback.packages.length,
          }),
        );

        return {
          ...base,
          packages: fallback.packages,
          error: null,
        };
      }

      this.logger.warn(
        JSON.stringify({
          msg: 'packages.list.no-structured-result',
          taskId: task.id,
          structuredFound: false,
          fallbackUsed: false,
          parsedCount: 0,
        }),
      );

      return {
        ...base,
        taskStatus: TaskStatus.FAILED,
        packages: [],
        error: 'Task completed without a structured package result.',
      };
    }

    return {
      ...base,
      packages: [],
      error: this.resolveTaskErrorMessage(task, normalized),
    };
  }

  private buildSearchResponse(
    task: TaskEntity,
    term: string,
    normalized: NormalizedPackageTaskResult | null,
  ): SearchPackagesResponseDto {
    const base = this.createAcceptedDto({
      taskId: task.id,
      taskStatus: task.status,
      nodeId: task.nodeId,
      operation: TASK_TYPES.PACKAGE_SEARCH,
      names: [],
      purge: null,
      term,
    });

    if (
      task.status === TaskStatus.SUCCESS &&
      normalized?.operation === TASK_TYPES.PACKAGE_SEARCH
    ) {
      return {
        ...base,
        results: normalized.results,
        error: null,
      };
    }

    if (task.status === TaskStatus.SUCCESS) {
      return {
        ...base,
        taskStatus: TaskStatus.FAILED,
        results: [],
        error: 'Task completed without a structured package result.',
      };
    }

    return {
      ...base,
      results: [],
      error: this.resolveTaskErrorMessage(task, normalized),
    };
  }

  private async buildAcceptedResponse(
    taskId: string,
    input: {
      nodeId: string;
      operation:
        | typeof TASK_TYPES.PACKAGE_LIST
        | typeof TASK_TYPES.PACKAGE_SEARCH
        | PackageMutationTaskType;
      names: string[];
      purge: boolean | null;
      term: string | null;
    },
  ): Promise<PackageTaskAcceptedDto> {
    const task = await this.tasksService.findOneOrFail(taskId);

    return this.createAcceptedDto({
      taskId,
      taskStatus: task.status,
      nodeId: input.nodeId,
      operation: input.operation,
      names: input.names,
      purge: input.purge,
      term: input.term,
    });
  }

  private createAcceptedDto(input: {
    taskId: string;
    taskStatus: TaskStatus;
    nodeId: string;
    operation:
      | typeof TASK_TYPES.PACKAGE_LIST
      | typeof TASK_TYPES.PACKAGE_SEARCH
      | PackageMutationTaskType;
    names: string[];
    purge: boolean | null;
    term: string | null;
  }): PackageTaskAcceptedDto {
    return {
      taskId: input.taskId,
      taskStatus: input.taskStatus,
      id: input.taskId,
      status: input.taskStatus,
      nodeId: input.nodeId,
      operation: input.operation,
      names: input.names,
      purge: input.purge,
      term: input.term,
    };
  }

  private resolveTaskErrorMessage(
    task: TaskEntity,
    normalized: NormalizedPackageTaskResult | null,
  ): string {
    if (
      normalized &&
      'output' in normalized &&
      typeof normalized.output === 'string' &&
      normalized.output.trim().length > 0
    ) {
      return normalized.output;
    }

    if (task.output?.trim()) {
      return task.output.trim();
    }

    if (
      task.result &&
      typeof task.result.error === 'string' &&
      task.result.error.trim().length > 0
    ) {
      return task.result.error.trim();
    }

    return 'Task did not complete successfully.';
  }

  private normalizeBoolean(
    value: boolean | string | null | undefined,
  ): boolean {
    return value === true || value === 'true';
  }

  private async getOrCreatePackageListTask(
    nodeId: string,
    workspaceId?: string,
  ): Promise<TaskEntity> {
    const inFlightTask = await this.findInFlightPackageListTask(
      nodeId,
      workspaceId,
    );
    if (inFlightTask) {
      this.logger.warn(
        JSON.stringify({
          msg: 'packages.list.reusing-inflight-task',
          nodeId,
          taskId: inFlightTask.id,
          status: inFlightTask.status,
        }),
      );
      return inFlightTask;
    }

    return this.tasksService.create(
      {
        nodeId,
        type: TASK_TYPES.PACKAGE_LIST,
        payload: {},
      },
      workspaceId,
    );
  }

  private async findInFlightPackageListTask(
    nodeId: string,
    workspaceId?: string,
  ): Promise<TaskEntity | null> {
    const tasks = await this.tasksService.findAll(
      {
        nodeId,
        limit: PACKAGE_RECENT_TASK_SCAN_LIMIT,
      },
      workspaceId,
    );

    const task = tasks.find(
      (candidate) =>
        candidate.type === TASK_TYPES.PACKAGE_LIST &&
        (candidate.status === TaskStatus.QUEUED ||
          candidate.status === TaskStatus.RUNNING),
    );

    return task ?? null;
  }

  private async findLatestSuccessfulPackageListTask(
    nodeId: string,
    workspaceId?: string,
  ): Promise<TaskEntity | null> {
    const tasks = await this.tasksService.findAll(
      {
        nodeId,
        limit: PACKAGE_RECENT_TASK_SCAN_LIMIT,
      },
      workspaceId,
    );

    const task = tasks.find(
      (candidate) =>
        candidate.type === TASK_TYPES.PACKAGE_LIST &&
        candidate.status === TaskStatus.SUCCESS,
    );

    return task ?? null;
  }

  private parseInstalledPackagesFromOutput(output: string | null): Array<{
    name: string;
    version: string | null;
    architecture: string | null;
    description: string | null;
  }> {
    if (!output || output.trim().length === 0) {
      return [];
    }

    const dpkgPackages = this.parseDpkgListOutput(output);
    if (dpkgPackages.length > 0) {
      return dpkgPackages;
    }

    return this.parseAptListInstalledOutput(output);
  }

  private parseInstalledPackagesWithFallbackSources(
    output: string | null,
    result: Record<string, unknown> | null,
  ): {
    source: string;
    packages: Array<{
      name: string;
      version: string | null;
      architecture: string | null;
      description: string | null;
    }>;
  } {
    const directOutputPackages = this.parseInstalledPackagesFromOutput(output);
    if (directOutputPackages.length > 0) {
      return {
        source: 'task.output',
        packages: directOutputPackages,
      };
    }

    const resultPackages =
      this.readStructuredPackageCollectionFromResult(result);
    if (resultPackages.length > 0) {
      return {
        source: 'task.result.packages',
        packages: resultPackages,
      };
    }

    const resultText = this.readStringFromRecord(result, [
      'output',
      'stdout',
      'message',
      'rawOutput',
    ]);
    const resultTextPackages =
      this.parseInstalledPackagesFromOutput(resultText);
    if (resultTextPackages.length > 0) {
      return {
        source: 'task.result.output-like',
        packages: resultTextPackages,
      };
    }

    return {
      source: 'none',
      packages: [],
    };
  }

  private readStructuredPackageCollectionFromResult(
    result: Record<string, unknown> | null,
  ): Array<{
    name: string;
    version: string | null;
    architecture: string | null;
    description: string | null;
  }> {
    if (!result) {
      return [];
    }

    const candidates = ['packages', 'installedPackages', 'installed'];
    for (const key of candidates) {
      if (!Array.isArray(result[key])) {
        continue;
      }

      const parsed = result[key]
        .map((entry) => this.normalizePackageEntry(entry))
        .filter(
          (
            entry,
          ): entry is {
            name: string;
            version: string | null;
            architecture: string | null;
            description: string | null;
          } => entry !== null,
        );

      if (parsed.length > 0) {
        return parsed;
      }
    }

    return [];
  }

  private normalizePackageEntry(value: unknown): {
    name: string;
    version: string | null;
    architecture: string | null;
    description: string | null;
  } | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const record = value as Record<string, unknown>;
    const name = this.readStringFromRecord(record, ['name', 'package']);
    if (!name) {
      return null;
    }

    return {
      name,
      version: this.readStringFromRecord(record, ['version']) ?? null,
      architecture:
        this.readStringFromRecord(record, ['architecture', 'arch']) ?? null,
      description:
        this.readStringFromRecord(record, ['description', 'summary']) ?? null,
    };
  }

  private parseDpkgListOutput(output: string): Array<{
    name: string;
    version: string | null;
    architecture: string | null;
    description: string | null;
  }> {
    const results: Array<{
      name: string;
      version: string | null;
      architecture: string | null;
      description: string | null;
    }> = [];

    const lines = output.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('ii ')) {
        continue;
      }

      const parts = trimmed.split(/\s+/);
      if (parts.length < 4) {
        continue;
      }

      results.push({
        name: parts[1],
        version: parts[2] ?? null,
        architecture: parts[3] ?? null,
        description: parts.slice(4).join(' ') || null,
      });
    }

    return results;
  }

  private parseAptListInstalledOutput(output: string): Array<{
    name: string;
    version: string | null;
    architecture: string | null;
    description: string | null;
  }> {
    const results: Array<{
      name: string;
      version: string | null;
      architecture: string | null;
      description: string | null;
    }> = [];

    const lines = output.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (
        trimmed.length === 0 ||
        trimmed.startsWith('Listing...') ||
        !trimmed.includes('[installed')
      ) {
        continue;
      }

      const match = trimmed.match(
        /^(\S+)\s+(\S+)\s+(\S+)\s+\[(installed[^\]]*)\]$/i,
      );
      if (!match) {
        continue;
      }

      const packageRef = match[1];
      const slashIndex = packageRef.indexOf('/');
      const name =
        slashIndex > 0 ? packageRef.slice(0, slashIndex) : packageRef;

      results.push({
        name,
        version: match[2] ?? null,
        architecture: match[3] ?? null,
        description: null,
      });
    }

    if (results.length > 0) {
      return results;
    }

    return this.parseNameVersionOutput(output);
  }

  private parseNameVersionOutput(output: string): Array<{
    name: string;
    version: string | null;
    architecture: string | null;
    description: string | null;
  }> {
    const results: Array<{
      name: string;
      version: string | null;
      architecture: string | null;
      description: string | null;
    }> = [];

    const lines = output.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        continue;
      }

      const match = trimmed.match(/^([a-z0-9.+-]+):([^\s]+)$/i);
      if (!match) {
        continue;
      }

      results.push({
        name: match[1],
        version: match[2],
        architecture: null,
        description: null,
      });
    }

    return results;
  }

  private readStringFromRecord(
    record: Record<string, unknown> | null,
    keys: string[],
  ): string | null {
    if (!record) {
      return null;
    }

    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
    }

    return null;
  }
}
