import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class IncidentsSchemaBootstrap implements OnModuleInit {
  private readonly logger = new Logger(IncidentsSchemaBootstrap.name);

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    if (this.dataSource.options.synchronize) {
      this.logger.debug(
        'Skipping incidents schema bootstrap because TypeORM synchronize is enabled',
      );
      return;
    }

    await this.dataSource.query(`
      CREATE EXTENSION IF NOT EXISTS pgcrypto
    `);

    await this.ensureIncidentSeverityEnumExists();

    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS "log_monitor_rules" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "workspaceId" uuid NOT NULL,
        "nodeId" uuid NOT NULL,
        "name" varchar(160) NOT NULL,
        "enabled" boolean NOT NULL DEFAULT true,
        "sourcePresetId" varchar(64) NOT NULL,
        "cadence" varchar(24) NOT NULL DEFAULT 'minutely',
        "intervalMinutes" smallint NOT NULL DEFAULT 1,
        "dsl" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "nextRunAt" TIMESTAMPTZ NULL,
        "lastRunAt" TIMESTAMPTZ NULL,
        "lastError" text NULL,
        "lastTaskId" uuid NULL,
        "leaseUntil" TIMESTAMPTZ NULL,
        "claimedBy" varchar(120) NULL,
        "claimToken" uuid NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_log_monitor_rules_id" PRIMARY KEY ("id")
      )
    `);

    await this.dataSource.query(`
      ALTER TABLE "log_monitor_rules"
      ADD COLUMN IF NOT EXISTS "workspaceId" uuid NULL,
      ADD COLUMN IF NOT EXISTS "nodeId" uuid NULL,
      ADD COLUMN IF NOT EXISTS "enabled" boolean NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS "sourcePresetId" varchar(64) NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS "cadence" varchar(24) NOT NULL DEFAULT 'minutely',
      ADD COLUMN IF NOT EXISTS "intervalMinutes" smallint NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS "dsl" jsonb NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS "nextRunAt" TIMESTAMPTZ NULL,
      ADD COLUMN IF NOT EXISTS "lastRunAt" TIMESTAMPTZ NULL,
      ADD COLUMN IF NOT EXISTS "lastError" text NULL,
      ADD COLUMN IF NOT EXISTS "lastTaskId" uuid NULL,
      ADD COLUMN IF NOT EXISTS "leaseUntil" TIMESTAMPTZ NULL,
      ADD COLUMN IF NOT EXISTS "claimedBy" varchar(120) NULL,
      ADD COLUMN IF NOT EXISTS "claimToken" uuid NULL
    `);

    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS "log_monitor_cursors" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "ruleId" uuid NOT NULL,
        "nodeId" uuid NOT NULL,
        "sourcePresetId" varchar(64) NOT NULL,
        "journalCursor" text NULL,
        "fileInode" text NULL,
        "fileOffset" bigint NULL,
        "lastReadAt" TIMESTAMPTZ NULL,
        "cursorResetReason" text NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_log_monitor_cursors_id" PRIMARY KEY ("id")
      )
    `);

    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS "incidents" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "workspaceId" uuid NOT NULL,
        "nodeId" uuid NOT NULL,
        "ruleId" uuid NOT NULL,
        "sourcePresetId" varchar(64) NOT NULL,
        "status" varchar(24) NOT NULL DEFAULT 'open',
        "severity" "incident_severity_enum" NOT NULL DEFAULT 'warning',
        "title" varchar(255) NOT NULL,
        "fingerprint" varchar(255) NOT NULL,
        "firstSeenAt" TIMESTAMPTZ NOT NULL,
        "lastSeenAt" TIMESTAMPTZ NOT NULL,
        "hitCount" integer NOT NULL DEFAULT 1,
        "latestSample" jsonb NULL,
        "latestTaskId" uuid NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_incidents_id" PRIMARY KEY ("id")
      )
    `);

    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS "incident_analyses" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "incidentId" uuid NOT NULL,
        "model" varchar(120) NOT NULL,
        "summary" text NOT NULL,
        "probableCauses" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "recommendedChecks" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "inputTokens" integer NULL,
        "outputTokens" integer NULL,
        "estimatedCostUsd" numeric(12,6) NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_incident_analyses_id" PRIMARY KEY ("id")
      )
    `);

    await this.dataSource.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_log_monitor_cursors_rule_id"
      ON "log_monitor_cursors" ("ruleId")
    `);

    await this.dataSource.query(`
      CREATE INDEX IF NOT EXISTS "IDX_log_monitor_rules_workspace_node"
      ON "log_monitor_rules" ("workspaceId", "nodeId")
    `);

    await this.dataSource.query(`
      CREATE INDEX IF NOT EXISTS "IDX_log_monitor_rules_enabled_next_run"
      ON "log_monitor_rules" ("enabled", "nextRunAt")
    `);

    await this.dataSource.query(`
      CREATE INDEX IF NOT EXISTS "IDX_incidents_workspace_status_last_seen"
      ON "incidents" ("workspaceId", "status", "lastSeenAt")
    `);

    await this.dataSource.query(`
      CREATE INDEX IF NOT EXISTS "IDX_incidents_node_rule_fingerprint_status"
      ON "incidents" ("nodeId", "ruleId", "fingerprint", "status")
    `);

    await this.dataSource.query(`
      CREATE INDEX IF NOT EXISTS "IDX_incident_analyses_incident_created_at"
      ON "incident_analyses" ("incidentId", "createdAt")
    `);

    this.logger.log('Ensured incidents schema exists');
  }

  private async ensureIncidentSeverityEnumExists(): Promise<void> {
    try {
      await this.dataSource.query(`
        CREATE TYPE "incident_severity_enum" AS ENUM ('info', 'warning', 'critical')
      `);
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error;
      }

      if (!error.message.toLowerCase().includes('already exists')) {
        throw error;
      }
    }
  }
}
