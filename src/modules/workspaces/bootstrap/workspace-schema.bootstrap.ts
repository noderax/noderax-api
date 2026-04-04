import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DEFAULT_TIMEZONE } from '../../../common/utils/timezone.util';

@Injectable()
export class WorkspaceSchemaBootstrap implements OnModuleInit {
  private readonly logger = new Logger(WorkspaceSchemaBootstrap.name);

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    if (process.env.NODE_ENV === 'test') {
      this.logger.log(
        'Skipping raw workspace schema bootstrap in test environment',
      );
      return;
    }

    await this.dataSource.query(`
      CREATE EXTENSION IF NOT EXISTS pgcrypto
    `);

    await this.ensureWorkspaceMembershipRoleEnumExists();
    await this.ensureTimezoneSourceEnumExists();
    await this.ensureNodeRootAccessProfileEnumExists();
    await this.ensureNodeRootAccessSyncStatusEnumExists();
    await this.ensurePlatformAdminRoleExists();
    await this.ensureWorkspaceTables();
    await this.ensureResourceWorkspaceColumns();
    await this.ensureWorkspaceForeignKeys();

    this.logger.log('Ensured workspace schema exists');
  }

  private async ensureWorkspaceTables(): Promise<void> {
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS "workspaces" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" varchar(160) NOT NULL,
        "slug" varchar(80) NOT NULL,
        "defaultTimezone" varchar(80) NOT NULL DEFAULT '${DEFAULT_TIMEZONE}',
        "createdByUserId" uuid NULL,
        "isArchived" boolean NOT NULL DEFAULT false,
        "isDefault" boolean NOT NULL DEFAULT false,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_workspaces_id" PRIMARY KEY ("id")
      )
    `);

    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS "workspace_memberships" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "workspaceId" uuid NOT NULL,
        "userId" uuid NOT NULL,
        "role" "workspace_membership_role_enum" NOT NULL DEFAULT 'member',
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_workspace_memberships_id" PRIMARY KEY ("id")
      )
    `);

    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS "teams" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "workspaceId" uuid NOT NULL,
        "name" varchar(120) NOT NULL,
        "description" text NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_teams_id" PRIMARY KEY ("id")
      )
    `);

    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS "team_memberships" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "teamId" uuid NOT NULL,
        "userId" uuid NOT NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_team_memberships_id" PRIMARY KEY ("id")
      )
    `);

    await this.dataSource.query(`
      ALTER TABLE "workspaces"
      ADD COLUMN IF NOT EXISTS "isDefault" boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS "automationEmailEnabled" boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS "automationTelegramEnabled" boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS "automationTelegramBotToken" varchar(255) NULL,
      ADD COLUMN IF NOT EXISTS "automationTelegramChatId" varchar(255) NULL
    `);

    await this.dataSource.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_workspaces_slug"
      ON "workspaces" ("slug")
    `);

    await this.dataSource.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_workspaces_single_default"
      ON "workspaces" ("isDefault")
      WHERE "isDefault" = true
    `);

    await this.dataSource.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_workspace_memberships_workspace_user"
      ON "workspace_memberships" ("workspaceId", "userId")
    `);

    await this.dataSource.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_teams_workspace_name"
      ON "teams" ("workspaceId", "name")
    `);

    await this.dataSource.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_team_memberships_team_user"
      ON "team_memberships" ("teamId", "userId")
    `);
  }

  private async ensureResourceWorkspaceColumns(): Promise<void> {
    await this.dataSource.query(`
      ALTER TABLE "nodes"
      ADD COLUMN IF NOT EXISTS "workspaceId" uuid NULL,
      ADD COLUMN IF NOT EXISTS "teamId" uuid NULL,
      ADD COLUMN IF NOT EXISTS "maintenanceMode" boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS "rootAccessProfile" "node_root_access_profile_enum" NOT NULL DEFAULT 'off',
      ADD COLUMN IF NOT EXISTS "rootAccessAppliedProfile" "node_root_access_profile_enum" NOT NULL DEFAULT 'off',
      ADD COLUMN IF NOT EXISTS "rootAccessSyncStatus" "node_root_access_sync_status_enum" NOT NULL DEFAULT 'pending',
      ADD COLUMN IF NOT EXISTS "rootAccessUpdatedAt" TIMESTAMPTZ NULL,
      ADD COLUMN IF NOT EXISTS "rootAccessUpdatedByUserId" uuid NULL,
      ADD COLUMN IF NOT EXISTS "rootAccessLastAppliedAt" TIMESTAMPTZ NULL,
      ADD COLUMN IF NOT EXISTS "rootAccessLastError" text NULL,
      ADD COLUMN IF NOT EXISTS "maintenanceReason" text NULL,
      ADD COLUMN IF NOT EXISTS "maintenanceStartedAt" TIMESTAMPTZ NULL,
      ADD COLUMN IF NOT EXISTS "maintenanceByUserId" uuid NULL,
      ADD COLUMN IF NOT EXISTS "agentVersion" varchar(64) NULL,
      ADD COLUMN IF NOT EXISTS "platformVersion" varchar(120) NULL,
      ADD COLUMN IF NOT EXISTS "kernelVersion" varchar(120) NULL,
      ADD COLUMN IF NOT EXISTS "lastVersionReportedAt" TIMESTAMPTZ NULL
    `);

    await this.dataSource.query(`
      ALTER TABLE "tasks"
      ADD COLUMN IF NOT EXISTS "workspaceId" uuid NULL
    `);

    await this.dataSource.query(`
      ALTER TABLE "events"
      ADD COLUMN IF NOT EXISTS "workspaceId" uuid NULL
    `);

    await this.dataSource.query(`
      ALTER TABLE "metrics"
      ADD COLUMN IF NOT EXISTS "workspaceId" uuid NULL
    `);

    await this.dataSource.query(`
      ALTER TABLE "enrollments"
      ADD COLUMN IF NOT EXISTS "workspaceId" uuid NULL
    `);

    await this.dataSource.query(`
      ALTER TABLE "scheduled_tasks"
      ADD COLUMN IF NOT EXISTS "workspaceId" uuid NULL,
      ADD COLUMN IF NOT EXISTS "timezoneSource" "scheduled_task_timezone_source_enum" NOT NULL DEFAULT 'legacy_fixed',
      ADD COLUMN IF NOT EXISTS "runAsRoot" boolean NOT NULL DEFAULT false
    `);

    await this.dataSource.query(`
      ALTER TABLE "workspaces"
      ADD COLUMN IF NOT EXISTS "isDefault" boolean NOT NULL DEFAULT false
    `);

    await this.dataSource
      .query(
        `
      ALTER TABLE "workspaces"
      ADD CONSTRAINT "FK_workspaces_created_by_user"
      FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL
    `,
      )
      .catch(() => undefined);

    await this.dataSource.query(`
      CREATE INDEX IF NOT EXISTS "IDX_nodes_workspace_id"
      ON "nodes" ("workspaceId")
    `);

    await this.dataSource.query(`
      CREATE INDEX IF NOT EXISTS "IDX_nodes_team_id"
      ON "nodes" ("teamId")
    `);

    await this.dataSource.query(`
      CREATE INDEX IF NOT EXISTS "IDX_tasks_workspace_created_at"
      ON "tasks" ("workspaceId", "createdAt")
    `);

    await this.dataSource.query(`
      CREATE INDEX IF NOT EXISTS "IDX_events_workspace_created_at"
      ON "events" ("workspaceId", "createdAt")
    `);

    await this.dataSource.query(`
      CREATE INDEX IF NOT EXISTS "IDX_metrics_workspace_recorded_at"
      ON "metrics" ("workspaceId", "recordedAt")
    `);

    await this.dataSource.query(`
      CREATE INDEX IF NOT EXISTS "IDX_enrollments_workspace_id"
      ON "enrollments" ("workspaceId")
    `);

    await this.dataSource.query(`
      CREATE INDEX IF NOT EXISTS "IDX_scheduled_tasks_workspace_id"
      ON "scheduled_tasks" ("workspaceId")
    `);
  }

  private async ensureWorkspaceForeignKeys(): Promise<void> {
    await this.dataSource
      .query(
        `
      ALTER TABLE "workspace_memberships"
      ADD CONSTRAINT "FK_workspace_memberships_workspace"
      FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE
    `,
      )
      .catch(() => undefined);

    await this.dataSource
      .query(
        `
      ALTER TABLE "workspace_memberships"
      ADD CONSTRAINT "FK_workspace_memberships_user"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
    `,
      )
      .catch(() => undefined);

    await this.dataSource
      .query(
        `
      ALTER TABLE "teams"
      ADD CONSTRAINT "FK_teams_workspace"
      FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE
    `,
      )
      .catch(() => undefined);

    await this.dataSource
      .query(
        `
      ALTER TABLE "team_memberships"
      ADD CONSTRAINT "FK_team_memberships_team"
      FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE
    `,
      )
      .catch(() => undefined);

    await this.dataSource
      .query(
        `
      ALTER TABLE "team_memberships"
      ADD CONSTRAINT "FK_team_memberships_user"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
    `,
      )
      .catch(() => undefined);

    await this.dataSource
      .query(
        `
      ALTER TABLE "nodes"
      ADD CONSTRAINT "FK_nodes_workspace"
      FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE
    `,
      )
      .catch(() => undefined);

    await this.dataSource
      .query(
        `
      ALTER TABLE "tasks"
      ADD CONSTRAINT "FK_tasks_workspace"
      FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE
    `,
      )
      .catch(() => undefined);

    await this.dataSource
      .query(
        `
      ALTER TABLE "events"
      ADD CONSTRAINT "FK_events_workspace"
      FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE
    `,
      )
      .catch(() => undefined);

    await this.dataSource
      .query(
        `
      ALTER TABLE "metrics"
      ADD CONSTRAINT "FK_metrics_workspace"
      FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE
    `,
      )
      .catch(() => undefined);

    await this.dataSource
      .query(
        `
      ALTER TABLE "enrollments"
      ADD CONSTRAINT "FK_enrollments_workspace"
      FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE SET NULL
    `,
      )
      .catch(() => undefined);

    await this.dataSource
      .query(
        `
      ALTER TABLE "scheduled_tasks"
      ADD CONSTRAINT "FK_scheduled_tasks_workspace"
      FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE
    `,
      )
      .catch(() => undefined);

    await this.dataSource
      .query(
        `
      ALTER TABLE "nodes"
      ADD CONSTRAINT "FK_nodes_team"
      FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL
    `,
      )
      .catch(() => undefined);
  }

  private async ensureNodeRootAccessProfileEnumExists(): Promise<void> {
    await this.dataSource
      .query(`
        CREATE TYPE "node_root_access_profile_enum" AS ENUM ('off', 'operational', 'task', 'terminal', 'all')
      `)
      .catch(() => undefined);
  }

  private async ensureNodeRootAccessSyncStatusEnumExists(): Promise<void> {
    await this.dataSource
      .query(`
        CREATE TYPE "node_root_access_sync_status_enum" AS ENUM ('pending', 'applied', 'failed')
      `)
      .catch(() => undefined);
  }

  private async ensureWorkspaceMembershipRoleEnumExists(): Promise<void> {
    try {
      await this.dataSource.query(`
        CREATE TYPE "workspace_membership_role_enum" AS ENUM ('owner', 'admin', 'member', 'viewer')
      `);
    } catch {
      return;
    }
  }

  private async ensureTimezoneSourceEnumExists(): Promise<void> {
    try {
      await this.dataSource.query(`
        CREATE TYPE "scheduled_task_timezone_source_enum" AS ENUM ('workspace', 'legacy_fixed')
      `);
    } catch {
      return;
    }
  }

  private async ensurePlatformAdminRoleExists(): Promise<void> {
    const existsResult = (await this.dataSource.query(
      `
        SELECT EXISTS (
          SELECT 1
          FROM pg_enum e
          JOIN pg_type t ON t.oid = e.enumtypid
          WHERE t.typname = 'user_role_enum'
            AND e.enumlabel = 'platform_admin'
        ) AS "exists"
      `,
    )) as Array<{ exists: boolean }>;

    if (existsResult[0]?.exists) {
      return;
    }

    await this.dataSource
      .query(
        `
      ALTER TYPE "user_role_enum" ADD VALUE 'platform_admin'
    `,
      )
      .catch(() => undefined);
  }
}
