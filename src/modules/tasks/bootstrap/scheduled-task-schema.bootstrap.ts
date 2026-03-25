import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SCHEDULED_TASK_TIMEZONE } from '../scheduled-task.utils';

@Injectable()
export class ScheduledTaskSchemaBootstrap implements OnModuleInit {
  private readonly logger = new Logger(ScheduledTaskSchemaBootstrap.name);

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    await this.dataSource.query(`
      CREATE EXTENSION IF NOT EXISTS pgcrypto
    `);

    if (!(await this.hasTable('scheduled_tasks'))) {
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS "scheduled_tasks" (
          "id" uuid NOT NULL DEFAULT gen_random_uuid(),
          "nodeId" uuid NOT NULL,
          "ownerUserId" uuid NULL,
          "name" varchar(160) NOT NULL,
          "command" text NOT NULL,
          "cadence" varchar(24) NOT NULL,
          "minute" smallint NOT NULL,
          "hour" smallint NULL,
          "dayOfWeek" smallint NULL,
          "timezone" varchar(80) NOT NULL DEFAULT '${SCHEDULED_TASK_TIMEZONE}',
          "enabled" boolean NOT NULL DEFAULT true,
          "nextRunAt" TIMESTAMPTZ NULL,
          "lastRunAt" TIMESTAMPTZ NULL,
          "lastRunTaskId" uuid NULL,
          "lastError" text NULL,
          "leaseUntil" TIMESTAMPTZ NULL,
          "claimedBy" varchar(120) NULL,
          "claimToken" uuid NULL,
          "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
          "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
          CONSTRAINT "PK_scheduled_tasks_id" PRIMARY KEY ("id"),
          CONSTRAINT "FK_scheduled_tasks_node" FOREIGN KEY ("nodeId") REFERENCES "nodes"("id") ON DELETE CASCADE,
          CONSTRAINT "FK_scheduled_tasks_owner" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE SET NULL
        )
      `);
    }

    await this.dataSource.query(`
      ALTER TABLE "scheduled_tasks"
      ADD COLUMN IF NOT EXISTS "ownerUserId" uuid NULL,
      ADD COLUMN IF NOT EXISTS "name" varchar(160) NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS "command" text NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS "cadence" varchar(24) NOT NULL DEFAULT 'hourly',
      ADD COLUMN IF NOT EXISTS "minute" smallint NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "hour" smallint NULL,
      ADD COLUMN IF NOT EXISTS "dayOfWeek" smallint NULL,
      ADD COLUMN IF NOT EXISTS "timezone" varchar(80) NOT NULL DEFAULT '${SCHEDULED_TASK_TIMEZONE}',
      ADD COLUMN IF NOT EXISTS "enabled" boolean NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS "nextRunAt" TIMESTAMPTZ NULL,
      ADD COLUMN IF NOT EXISTS "lastRunAt" TIMESTAMPTZ NULL,
      ADD COLUMN IF NOT EXISTS "lastRunTaskId" uuid NULL,
      ADD COLUMN IF NOT EXISTS "lastError" text NULL,
      ADD COLUMN IF NOT EXISTS "leaseUntil" TIMESTAMPTZ NULL,
      ADD COLUMN IF NOT EXISTS "claimedBy" varchar(120) NULL,
      ADD COLUMN IF NOT EXISTS "claimToken" uuid NULL
    `);

    await this.dataSource.query(`
      ALTER TABLE "scheduled_tasks"
      ALTER COLUMN "timezone" TYPE varchar(80)
    `);

    if (!(await this.hasConstraint('FK_scheduled_tasks_owner'))) {
      await this.dataSource.query(`
        ALTER TABLE "scheduled_tasks"
        ADD CONSTRAINT "FK_scheduled_tasks_owner"
        FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE SET NULL
      `);
    }

    await this.dataSource.query(`
      CREATE INDEX IF NOT EXISTS "IDX_scheduled_tasks_enabled_next_run"
      ON "scheduled_tasks" ("enabled", "nextRunAt")
    `);

    await this.dataSource.query(`
      CREATE INDEX IF NOT EXISTS "IDX_scheduled_tasks_node_enabled_next_run"
      ON "scheduled_tasks" ("nodeId", "enabled", "nextRunAt")
    `);

    await this.dataSource.query(`
      CREATE INDEX IF NOT EXISTS "IDX_scheduled_tasks_owner_user"
      ON "scheduled_tasks" ("ownerUserId")
    `);

    this.logger.log('Ensured scheduled task schema exists');
  }

  private async hasTable(tableName: string): Promise<boolean> {
    const result = (await this.dataSource.query(
      `
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name = $1
        ) AS "exists"
      `,
      [tableName],
    )) as Array<{ exists: boolean }>;

    return Boolean(result[0]?.exists);
  }

  private async hasConstraint(constraintName: string): Promise<boolean> {
    const result = (await this.dataSource.query(
      `
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.table_constraints
          WHERE table_schema = 'public'
            AND constraint_name = $1
        ) AS "exists"
      `,
      [constraintName],
    )) as Array<{ exists: boolean }>;

    return Boolean(result[0]?.exists);
  }
}
