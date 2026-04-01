import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class AgentUpdateSchemaBootstrap implements OnModuleInit {
  private readonly logger = new Logger(AgentUpdateSchemaBootstrap.name);

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    if (this.dataSource.options.synchronize) {
      this.logger.debug(
        'Skipping agent update schema bootstrap because TypeORM synchronize is enabled',
      );
      return;
    }

    await this.dataSource.query(`
      CREATE EXTENSION IF NOT EXISTS pgcrypto
    `);

    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS "agent_update_rollouts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "targetVersion" varchar(80) NOT NULL,
        "status" varchar(32) NOT NULL DEFAULT 'queued',
        "rollback" boolean NOT NULL DEFAULT false,
        "requestedByUserId" uuid NULL,
        "requestedByEmailSnapshot" varchar(255) NULL,
        "startedAt" TIMESTAMPTZ NULL,
        "completedAt" TIMESTAMPTZ NULL,
        "cancelledAt" TIMESTAMPTZ NULL,
        "statusMessage" text NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agent_update_rollouts_id" PRIMARY KEY ("id")
      )
    `);

    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS "agent_update_rollout_targets" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "rolloutId" uuid NOT NULL,
        "nodeId" uuid NOT NULL,
        "workspaceId" uuid NOT NULL,
        "teamId" uuid NULL,
        "nodeNameSnapshot" varchar(160) NOT NULL,
        "previousVersion" varchar(80) NULL,
        "targetVersion" varchar(80) NOT NULL,
        "status" varchar(32) NOT NULL DEFAULT 'pending',
        "progressPercent" integer NOT NULL DEFAULT 0,
        "statusMessage" text NULL,
        "taskId" uuid NULL,
        "sequence" integer NOT NULL DEFAULT 0,
        "dispatchedAt" TIMESTAMPTZ NULL,
        "completedAt" TIMESTAMPTZ NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agent_update_rollout_targets_id" PRIMARY KEY ("id")
      )
    `);

    await this.dataSource
      .query(
        `
        ALTER TABLE "agent_update_rollout_targets"
        ADD CONSTRAINT "FK_agent_update_rollout_targets_rollout"
        FOREIGN KEY ("rolloutId") REFERENCES "agent_update_rollouts"("id") ON DELETE CASCADE
      `,
      )
      .catch(() => undefined);

    await this.dataSource.query(`
      CREATE INDEX IF NOT EXISTS "IDX_agent_update_rollouts_status"
      ON "agent_update_rollouts" ("status")
    `);

    await this.dataSource.query(`
      CREATE INDEX IF NOT EXISTS "IDX_agent_update_rollouts_target_version"
      ON "agent_update_rollouts" ("targetVersion")
    `);

    await this.dataSource.query(`
      CREATE INDEX IF NOT EXISTS "IDX_agent_update_rollout_targets_rollout_sequence"
      ON "agent_update_rollout_targets" ("rolloutId", "sequence")
    `);

    await this.dataSource.query(`
      CREATE INDEX IF NOT EXISTS "IDX_agent_update_rollout_targets_node_status"
      ON "agent_update_rollout_targets" ("nodeId", "status")
    `);

    await this.dataSource.query(`
      CREATE INDEX IF NOT EXISTS "IDX_agent_update_rollout_targets_task_id"
      ON "agent_update_rollout_targets" ("taskId")
    `);

    this.logger.log('Ensured agent update rollout schema exists');
  }
}
