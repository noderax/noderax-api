import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class EnrollmentSchemaBootstrap implements OnModuleInit {
  private readonly logger = new Logger(EnrollmentSchemaBootstrap.name);

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    if (this.dataSource.options.synchronize) {
      this.logger.debug(
        'Skipping enrollment schema bootstrap because TypeORM synchronize is enabled',
      );
      return;
    }

    await this.dataSource.query(`
      CREATE EXTENSION IF NOT EXISTS pgcrypto
    `);

    await this.ensureEnrollmentStatusEnumExists();

    if (!(await this.hasTable('enrollments'))) {
      await this.dataSource.query(`
        CREATE TABLE "enrollments" (
          "id" uuid NOT NULL DEFAULT gen_random_uuid(),
          "email" character varying(255) NOT NULL,
          "tokenHash" character varying(255) NOT NULL,
          "tokenLookupHash" character varying(64) NOT NULL,
          "hostname" character varying(255) NOT NULL,
          "additionalInfo" jsonb NULL,
          "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
          "expiresAt" TIMESTAMPTZ NOT NULL,
          "status" "enrollment_status_enum" NOT NULL DEFAULT 'pending',
          "nodeId" uuid NULL,
          "agentToken" text NULL,
          CONSTRAINT "PK_enrollments_id" PRIMARY KEY ("id")
        )
      `);
    }

    if (!(await this.hasTable('node_installs'))) {
      await this.dataSource.query(`
        CREATE TABLE "node_installs" (
          "id" uuid NOT NULL DEFAULT gen_random_uuid(),
          "workspaceId" uuid NOT NULL,
          "teamId" uuid NULL,
          "nodeName" character varying(120) NOT NULL,
          "description" text NULL,
          "tokenHash" character varying(255) NOT NULL,
          "tokenLookupHash" character varying(64) NOT NULL,
          "hostname" character varying(255) NULL,
          "additionalInfo" jsonb NULL,
          "nodeId" uuid NULL,
          "status" character varying(32) NOT NULL DEFAULT 'pending',
          "stage" character varying(64) NOT NULL DEFAULT 'command_generated',
          "progressPercent" integer NOT NULL DEFAULT 5,
          "statusMessage" text NULL,
          "startedAt" TIMESTAMPTZ NULL,
          "consumedAt" TIMESTAMPTZ NULL,
          "expiresAt" TIMESTAMPTZ NOT NULL,
          "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
          "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
          CONSTRAINT "PK_node_installs_id" PRIMARY KEY ("id")
        )
      `);
    }

    await this.dataSource.query(`
      ALTER TABLE "nodes"
      ADD COLUMN IF NOT EXISTS "description" text NULL
    `);

    await this.dataSource.query(`
      ALTER TABLE "node_installs"
      ADD COLUMN IF NOT EXISTS "status" character varying(32) NOT NULL DEFAULT 'pending'
    `);

    await this.dataSource.query(`
      ALTER TABLE "node_installs"
      ADD COLUMN IF NOT EXISTS "stage" character varying(64) NOT NULL DEFAULT 'command_generated'
    `);

    await this.dataSource.query(`
      ALTER TABLE "node_installs"
      ADD COLUMN IF NOT EXISTS "progressPercent" integer NOT NULL DEFAULT 5
    `);

    await this.dataSource.query(`
      ALTER TABLE "node_installs"
      ADD COLUMN IF NOT EXISTS "statusMessage" text NULL
    `);

    await this.dataSource.query(`
      ALTER TABLE "node_installs"
      ADD COLUMN IF NOT EXISTS "startedAt" TIMESTAMPTZ NULL
    `);

    await this.dataSource.query(`
      ALTER TABLE "node_installs"
      ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
    `);

    await this.dataSource.query(`
      CREATE OR REPLACE FUNCTION sync_node_installs_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW."updatedAt" = now();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);

    await this.dataSource.query(`
      DROP TRIGGER IF EXISTS "trg_node_installs_updated_at" ON "node_installs"
    `);

    await this.dataSource.query(`
      CREATE TRIGGER "trg_node_installs_updated_at"
      BEFORE UPDATE ON "node_installs"
      FOR EACH ROW
      EXECUTE FUNCTION sync_node_installs_updated_at()
    `);

    await this.dataSource.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_enrollments_token_lookup_hash"
      ON "enrollments" ("tokenLookupHash")
    `);

    await this.dataSource.query(`
      CREATE INDEX IF NOT EXISTS "IDX_enrollments_status"
      ON "enrollments" ("status")
    `);

    await this.dataSource.query(`
      CREATE INDEX IF NOT EXISTS "IDX_enrollments_expires_at"
      ON "enrollments" ("expiresAt")
    `);

    await this.dataSource.query(`
      CREATE INDEX IF NOT EXISTS "IDX_enrollments_node_id"
      ON "enrollments" ("nodeId")
    `);

    await this.dataSource.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_node_installs_token_lookup_hash"
      ON "node_installs" ("tokenLookupHash")
    `);

    await this.dataSource.query(`
      CREATE INDEX IF NOT EXISTS "IDX_node_installs_workspace_id"
      ON "node_installs" ("workspaceId")
    `);

    await this.dataSource.query(`
      CREATE INDEX IF NOT EXISTS "IDX_node_installs_team_id"
      ON "node_installs" ("teamId")
    `);

    await this.dataSource.query(`
      CREATE INDEX IF NOT EXISTS "IDX_node_installs_hostname"
      ON "node_installs" ("hostname")
    `);

    await this.dataSource.query(`
      CREATE INDEX IF NOT EXISTS "IDX_node_installs_node_id"
      ON "node_installs" ("nodeId")
    `);

    await this.dataSource.query(`
      CREATE INDEX IF NOT EXISTS "IDX_node_installs_expires_at"
      ON "node_installs" ("expiresAt")
    `);

    this.logger.log('Ensured enrollment schema exists');
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

  private async ensureEnrollmentStatusEnumExists(): Promise<void> {
    try {
      await this.dataSource.query(`
        CREATE TYPE "enrollment_status_enum" AS ENUM ('pending', 'approved', 'revoked')
      `);
    } catch (error) {
      if (this.isDuplicateTypeError(error)) {
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
      message.includes('enrollment_status_enum')
    );
  }
}
