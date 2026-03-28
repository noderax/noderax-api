import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class TaskSchemaBootstrap implements OnModuleInit {
  private readonly logger = new Logger(TaskSchemaBootstrap.name);

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    if (!(await this.hasTable('tasks'))) {
      this.logger.warn(
        'Skipping task schema bootstrap because the "tasks" table does not exist',
      );
      return;
    }

    await this.ensureTaskStatusEnumValueExists('accepted');
    await this.ensureTaskStatusEnumValueExists('claimed');

    await this.dataSource.query(`
      ALTER TABLE "tasks"
      ADD COLUMN IF NOT EXISTS "result" jsonb NULL,
      ADD COLUMN IF NOT EXISTS "output" text NULL,
      ADD COLUMN IF NOT EXISTS "outputTruncated" boolean NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS "startedAt" TIMESTAMPTZ NULL,
      ADD COLUMN IF NOT EXISTS "finishedAt" TIMESTAMPTZ NULL,
      ADD COLUMN IF NOT EXISTS "cancelRequestedAt" TIMESTAMPTZ NULL,
      ADD COLUMN IF NOT EXISTS "cancelReason" text NULL,
      ADD COLUMN IF NOT EXISTS "leaseUntil" TIMESTAMPTZ NULL,
      ADD COLUMN IF NOT EXISTS "claimedBy" uuid NULL,
      ADD COLUMN IF NOT EXISTS "claimToken" uuid NULL,
      ADD COLUMN IF NOT EXISTS "targetTeamId" uuid NULL,
      ADD COLUMN IF NOT EXISTS "templateId" uuid NULL,
      ADD COLUMN IF NOT EXISTS "templateName" varchar(160) NULL
    `);

    if (!(await this.hasTable('task_logs'))) {
      await this.dataSource.query(`
        CREATE EXTENSION IF NOT EXISTS pgcrypto
      `);

      await this.ensureTaskLogLevelEnumExists();

      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS "task_logs" (
          "id" uuid NOT NULL DEFAULT gen_random_uuid(),
          "taskId" uuid NOT NULL,
          "level" "task_log_level_enum" NOT NULL DEFAULT 'info',
          "message" text NOT NULL,
          "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
          "timestamp" TIMESTAMPTZ NULL,
          CONSTRAINT "PK_task_logs_id" PRIMARY KEY ("id"),
          CONSTRAINT "FK_task_logs_task" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE
        )
      `);

      await this.dataSource.query(`
        CREATE INDEX IF NOT EXISTS "IDX_task_logs_task_created_at"
        ON "task_logs" ("taskId", "createdAt")
      `);
    }

    await this.dataSource.query(`
      ALTER TABLE "task_logs"
      ADD COLUMN IF NOT EXISTS "timestamp" TIMESTAMPTZ NULL
    `);

    await this.dataSource.query(`
      UPDATE "task_logs"
      SET "timestamp" = COALESCE("timestamp", "createdAt")
      WHERE "timestamp" IS NULL
    `);

    this.logger.log('Ensured task schema columns exist');
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

  private async ensureTaskLogLevelEnumExists(): Promise<void> {
    try {
      await this.dataSource.query(`
        CREATE TYPE "task_log_level_enum" AS ENUM ('info', 'stdout', 'stderr', 'error')
      `);
    } catch (error) {
      if (this.isDuplicateTypeError(error)) {
        return;
      }

      throw error;
    }
  }

  private async ensureTaskStatusEnumValueExists(value: string): Promise<void> {
    const existsResult = (await this.dataSource.query(
      `
        SELECT EXISTS (
          SELECT 1
          FROM pg_enum e
          JOIN pg_type t ON t.oid = e.enumtypid
          WHERE t.typname = 'task_status_enum'
            AND e.enumlabel = $1
        ) AS "exists"
      `,
      [value],
    )) as Array<{ exists: boolean }>;

    if (existsResult[0]?.exists) {
      return;
    }

    try {
      await this.dataSource.query(
        `ALTER TYPE "task_status_enum" ADD VALUE '${value}'`,
      );
    } catch (error) {
      if (this.isDuplicateEnumValueError(error)) {
        return;
      }

      throw error;
    }
  }

  private isDuplicateTypeError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    const message = error.message.toLowerCase();
    return (
      message.includes('already exists') &&
      message.includes('task_log_level_enum')
    );
  }

  private isDuplicateEnumValueError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    const message = error.message.toLowerCase();
    return (
      message.includes('already exists') && message.includes('task_status_enum')
    );
  }
}
