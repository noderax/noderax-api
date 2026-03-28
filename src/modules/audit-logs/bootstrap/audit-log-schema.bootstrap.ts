import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class AuditLogSchemaBootstrap implements OnModuleInit {
  private readonly logger = new Logger(AuditLogSchemaBootstrap.name);

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    await this.dataSource.query(`
      CREATE EXTENSION IF NOT EXISTS pgcrypto
    `);

    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS "audit_logs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "scope" varchar(24) NOT NULL,
        "workspaceId" uuid NULL,
        "actorType" varchar(24) NOT NULL DEFAULT 'user',
        "actorUserId" uuid NULL,
        "actorEmailSnapshot" varchar(255) NULL,
        "action" varchar(120) NOT NULL,
        "targetType" varchar(80) NOT NULL,
        "targetId" varchar(120) NULL,
        "targetLabel" varchar(255) NULL,
        "ipAddress" varchar(120) NULL,
        "userAgent" text NULL,
        "changes" jsonb NULL,
        "metadata" jsonb NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_audit_logs_id" PRIMARY KEY ("id")
      )
    `);

    await this.dataSource.query(`
      CREATE INDEX IF NOT EXISTS "IDX_audit_logs_scope_created_at"
      ON "audit_logs" ("scope", "createdAt")
    `);

    await this.dataSource.query(`
      CREATE INDEX IF NOT EXISTS "IDX_audit_logs_workspace_created_at"
      ON "audit_logs" ("workspaceId", "createdAt")
    `);

    this.logger.log('Ensured audit log schema exists');
  }
}
