import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PUBSUB_CHANNELS } from '../../common/constants/pubsub.constants';
import { SYSTEM_EVENT_TYPES } from '../../common/constants/system-event.constants';
import { RedisService } from '../../redis/redis.service';
import { EventSeverity } from '../events/entities/event-severity.enum';
import { EventsService } from '../events/events.service';
import { NodesService } from '../nodes/nodes.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { CreateTaskDto } from './dto/create-task.dto';
import { QueryTasksDto } from './dto/query-tasks.dto';
import { TaskEntity } from './entities/task.entity';
import { TaskStatus } from './entities/task-status.enum';

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(TaskEntity)
    private readonly tasksRepository: Repository<TaskEntity>,
    private readonly nodesService: NodesService,
    private readonly eventsService: EventsService,
    private readonly realtimeGateway: RealtimeGateway,
    private readonly redisService: RedisService,
  ) {}

  async create(createTaskDto: CreateTaskDto) {
    await this.nodesService.ensureExists(createTaskDto.nodeId);

    const task = this.tasksRepository.create({
      nodeId: createTaskDto.nodeId,
      type: createTaskDto.type,
      payload: createTaskDto.payload ?? {},
      status: TaskStatus.QUEUED,
    });

    const savedTask = await this.tasksRepository.save(task);

    await this.eventsService.record({
      nodeId: savedTask.nodeId,
      type: SYSTEM_EVENT_TYPES.TASK_QUEUED,
      severity: EventSeverity.INFO,
      message: `Task ${savedTask.type} queued for node ${savedTask.nodeId}`,
      metadata: {
        taskId: savedTask.id,
        taskType: savedTask.type,
      },
    });

    this.realtimeGateway.emitTaskCreated(
      savedTask as unknown as Record<string, unknown>,
    );
    await this.redisService.publish(PUBSUB_CHANNELS.TASKS_CREATED, {
      taskId: savedTask.id,
      nodeId: savedTask.nodeId,
      status: savedTask.status,
    });

    return savedTask;
  }

  async findAll(query: QueryTasksDto) {
    const tasksQuery = this.tasksRepository
      .createQueryBuilder('task')
      .orderBy('task.createdAt', 'DESC');

    if (query.nodeId) {
      tasksQuery.andWhere('task.nodeId = :nodeId', { nodeId: query.nodeId });
    }

    if (query.status) {
      tasksQuery.andWhere('task.status = :status', { status: query.status });
    }

    return tasksQuery.getMany();
  }

  async findOneOrFail(id: string) {
    const task = await this.tasksRepository.findOne({ where: { id } });

    if (!task) {
      throw new NotFoundException(`Task ${id} was not found`);
    }

    return task;
  }
}
