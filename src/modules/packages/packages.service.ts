import { HttpStatus, Injectable } from '@nestjs/common';
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
  constructor(private readonly tasksService: TasksService) {}

  async listInstalled(
    nodeId: string,
  ): Promise<
    PackageHttpResponse<ListPackagesResponseDto | PackageTaskAcceptedDto>
  > {
    const task = await this.tasksService.create({
      nodeId,
      type: TASK_TYPES.PACKAGE_LIST,
      payload: {},
    });

    return this.resolveReadTask(task.id, {
      nodeId,
      operation: TASK_TYPES.PACKAGE_LIST,
      term: null,
    });
  }

  async search(
    query: QueryPackageSearchDto,
  ): Promise<
    PackageHttpResponse<SearchPackagesResponseDto | PackageTaskAcceptedDto>
  > {
    const task = await this.tasksService.create({
      nodeId: query.nodeId,
      type: TASK_TYPES.PACKAGE_SEARCH,
      payload: {
        term: query.term,
        query: query.term,
      },
    });

    return this.resolveReadTask(task.id, {
      nodeId: query.nodeId,
      operation: TASK_TYPES.PACKAGE_SEARCH,
      term: query.term,
    });
  }

  async install(
    nodeId: string,
    installPackagesDto: InstallPackagesDto,
  ): Promise<PackageTaskAcceptedDto> {
    const names = installPackagesDto.names;
    const purge = installPackagesDto.purge ?? false;
    const task = await this.tasksService.create({
      nodeId,
      type: TASK_TYPES.PACKAGE_INSTALL,
      payload: {
        names,
        packages: names,
        package: names.length === 1 ? names[0] : undefined,
        purge,
      },
    });

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
  ): Promise<PackageTaskAcceptedDto> {
    const purge = this.normalizeBoolean(
      query.purge as boolean | string | null | undefined,
    );
    const operation = purge
      ? TASK_TYPES.PACKAGE_PURGE
      : TASK_TYPES.PACKAGE_REMOVE;
    const queuedTaskType = TASK_TYPES.PACKAGE_REMOVE;
    const task = await this.tasksService.create({
      nodeId,
      type: queuedTaskType,
      payload: {
        names: [name],
        packages: [name],
        package: name,
        purge,
      },
    });

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
      return {
        ...base,
        packages: normalized.packages,
        error: null,
      };
    }

    if (task.status === TaskStatus.SUCCESS) {
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
}
