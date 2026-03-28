import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class TaskTemplateSchemaBootstrap implements OnModuleInit {
  private readonly logger = new Logger(TaskTemplateSchemaBootstrap.name);

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    await this.dataSource.query(`
      CREATE EXTENSION IF NOT EXISTS pgcrypto
    `);

    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS "task_templates" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "workspaceId" uuid NOT NULL,
        "name" varchar(160) NOT NULL,
        "description" text NULL,
        "taskType" varchar(120) NOT NULL,
        "payloadTemplate" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "createdByUserId" uuid NOT NULL,
        "updatedByUserId" uuid NOT NULL,
        "archivedAt" TIMESTAMPTZ NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_task_templates_id" PRIMARY KEY ("id")
      )
    `);

    await this.dataSource.query(`
      CREATE INDEX IF NOT EXISTS "IDX_task_templates_workspace_created_at"
      ON "task_templates" ("workspaceId", "createdAt")
    `);

    await this.dataSource
      .query(
        `
        ALTER TABLE "task_templates"
        ADD CONSTRAINT "FK_task_templates_workspace"
        FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE
      `,
      )
      .catch(() => undefined);

    await this.dataSource.query(`
      ALTER TABLE "tasks"
      ADD COLUMN IF NOT EXISTS "targetTeamId" uuid NULL,
      ADD COLUMN IF NOT EXISTS "templateId" uuid NULL,
      ADD COLUMN IF NOT EXISTS "templateName" varchar(160) NULL
    `);

    await this.dataSource.query(`
      CREATE INDEX IF NOT EXISTS "IDX_tasks_target_team_created_at"
      ON "tasks" ("targetTeamId", "createdAt")
    `);

    this.logger.log('Ensured task template schema exists');
  }
}
