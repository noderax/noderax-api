import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RequestAuditContext } from '../../common/types/request-audit-context.type';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthenticatedUser } from '../../common/types/authenticated-user.type';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { CreateTaskTemplateDto } from './dto/create-task-template.dto';
import { UpdateTaskTemplateDto } from './dto/update-task-template.dto';
import { TaskTemplateEntity } from './entities/task-template.entity';

@Injectable()
export class TaskTemplatesService {
  constructor(
    @InjectRepository(TaskTemplateEntity)
    private readonly taskTemplatesRepository: Repository<TaskTemplateEntity>,
    private readonly workspacesService: WorkspacesService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async findAll(workspaceId: string): Promise<TaskTemplateEntity[]> {
    await this.workspacesService.findWorkspaceOrFail(workspaceId);

    return this.taskTemplatesRepository.find({
      where: {
        workspaceId,
      },
      order: {
        archivedAt: 'ASC',
        createdAt: 'DESC',
      },
    });
  }

  async findOneOrFail(
    id: string,
    workspaceId: string,
  ): Promise<TaskTemplateEntity> {
    const template = await this.taskTemplatesRepository.findOne({
      where: { id, workspaceId },
    });

    if (!template) {
      throw new NotFoundException(`Task template ${id} was not found`);
    }

    return template;
  }

  async create(
    workspaceId: string,
    actor: AuthenticatedUser,
    dto: CreateTaskTemplateDto,
    context?: RequestAuditContext,
  ): Promise<TaskTemplateEntity> {
    await this.workspacesService.assertWorkspaceWritable(workspaceId);

    const template = await this.taskTemplatesRepository.save(
      this.taskTemplatesRepository.create({
        workspaceId,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        taskType: dto.taskType.trim(),
        payloadTemplate: dto.payloadTemplate,
        createdByUserId: actor.id,
        updatedByUserId: actor.id,
        archivedAt: null,
      }),
    );

    await this.auditLogsService.record({
      scope: 'workspace',
      workspaceId,
      action: 'task-template.created',
      targetType: 'task-template',
      targetId: template.id,
      targetLabel: template.name,
      metadata: {
        taskType: template.taskType,
      },
      context,
    });

    return template;
  }

  async update(
    workspaceId: string,
    id: string,
    actor: AuthenticatedUser,
    dto: UpdateTaskTemplateDto,
    context?: RequestAuditContext,
  ): Promise<TaskTemplateEntity> {
    await this.workspacesService.assertWorkspaceWritable(workspaceId);
    const template = await this.findOneOrFail(id, workspaceId);
    const previous = {
      name: template.name,
      description: template.description,
      taskType: template.taskType,
      payloadTemplate: template.payloadTemplate,
      archivedAt: template.archivedAt?.toISOString() ?? null,
    };

    if (dto.name !== undefined) {
      template.name = dto.name.trim();
    }
    if (dto.description !== undefined) {
      template.description = dto.description?.trim() || null;
    }
    if (dto.taskType !== undefined) {
      template.taskType = dto.taskType.trim();
    }
    if (dto.payloadTemplate !== undefined) {
      template.payloadTemplate = dto.payloadTemplate;
    }
    template.updatedByUserId = actor.id;

    const saved = await this.taskTemplatesRepository.save(template);

    await this.auditLogsService.record({
      scope: 'workspace',
      workspaceId,
      action: 'task-template.updated',
      targetType: 'task-template',
      targetId: saved.id,
      targetLabel: saved.name,
      changes: {
        before: previous,
        after: {
          name: saved.name,
          description: saved.description,
          taskType: saved.taskType,
          payloadTemplate: saved.payloadTemplate,
          archivedAt: saved.archivedAt?.toISOString() ?? null,
        },
      },
      context,
    });

    return saved;
  }

  async delete(
    workspaceId: string,
    id: string,
    context?: RequestAuditContext,
  ): Promise<{ deleted: true; id: string }> {
    await this.workspacesService.assertWorkspaceWritable(workspaceId);
    const template = await this.findOneOrFail(id, workspaceId);
    await this.taskTemplatesRepository.remove(template);

    await this.auditLogsService.record({
      scope: 'workspace',
      workspaceId,
      action: 'task-template.deleted',
      targetType: 'task-template',
      targetId: template.id,
      targetLabel: template.name,
      context,
    });

    return {
      deleted: true,
      id,
    };
  }
}
