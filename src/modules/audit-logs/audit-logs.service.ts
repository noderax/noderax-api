import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RequestAuditContext } from '../../common/types/request-audit-context.type';
import { QueryAuditLogsDto } from './dto/query-audit-logs.dto';
import { AuditLogEntity } from './entities/audit-log.entity';

@Injectable()
export class AuditLogsService {
  constructor(
    @InjectRepository(AuditLogEntity)
    private readonly auditLogsRepository: Repository<AuditLogEntity>,
  ) {}

  async record(input: {
    scope: 'platform' | 'workspace';
    workspaceId?: string | null;
    action: string;
    targetType: string;
    targetId?: string | null;
    targetLabel?: string | null;
    changes?: Record<string, unknown> | null;
    metadata?: Record<string, unknown> | null;
    context?: RequestAuditContext;
  }) {
    const record = this.auditLogsRepository.create({
      scope: input.scope,
      workspaceId: input.workspaceId ?? null,
      actorType: input.context?.actorType ?? 'user',
      actorUserId: input.context?.actorUserId ?? null,
      actorEmailSnapshot: input.context?.actorEmailSnapshot ?? null,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      targetLabel: input.targetLabel ?? null,
      ipAddress: input.context?.ipAddress ?? null,
      userAgent: input.context?.userAgent ?? null,
      changes: input.changes ?? null,
      metadata: input.metadata ?? null,
    });

    return this.auditLogsRepository.save(record);
  }

  findAll(query: QueryAuditLogsDto, workspaceId?: string) {
    const builder = this.auditLogsRepository
      .createQueryBuilder('audit')
      .orderBy('audit.createdAt', 'DESC')
      .take(query.limit ?? 50);

    if (workspaceId) {
      builder.where('audit.workspaceId = :workspaceId', { workspaceId });
    } else {
      builder.where('audit.scope = :scope', { scope: 'platform' });
    }

    if (query.actor) {
      builder.andWhere(
        '(audit."actorEmailSnapshot" ILIKE :actor OR audit."actorUserId"::text = :actorExact)',
        {
          actor: `%${query.actor}%`,
          actorExact: query.actor,
        },
      );
    }

    if (query.action) {
      builder.andWhere('audit.action ILIKE :action', {
        action: `%${query.action}%`,
      });
    }

    if (query.targetType) {
      builder.andWhere('audit."targetType" = :targetType', {
        targetType: query.targetType,
      });
    }

    if (query.from) {
      builder.andWhere('audit."createdAt" >= :from', {
        from: new Date(query.from),
      });
    }

    if (query.to) {
      builder.andWhere('audit."createdAt" <= :to', {
        to: new Date(query.to),
      });
    }

    return builder.getMany();
  }
}
