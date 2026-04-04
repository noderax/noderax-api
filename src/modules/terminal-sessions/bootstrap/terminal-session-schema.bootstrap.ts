import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class TerminalSessionSchemaBootstrap implements OnModuleInit {
  private readonly logger = new Logger(TerminalSessionSchemaBootstrap.name);

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    if (this.dataSource.options.synchronize) {
      this.logger.debug(
        'Skipping terminal session schema bootstrap because TypeORM synchronize is enabled',
      );
      return;
    }

    await this.dataSource.query(`
      CREATE EXTENSION IF NOT EXISTS pgcrypto
    `);

    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS "terminal_sessions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "workspaceId" uuid NOT NULL,
        "nodeId" uuid NOT NULL,
        "createdByUserId" uuid NULL,
        "createdByEmailSnapshot" varchar(255) NULL,
        "status" varchar(24) NOT NULL DEFAULT 'pending',
        "openedAt" TIMESTAMPTZ NULL,
        "closedAt" TIMESTAMPTZ NULL,
        "closedReason" text NULL,
        "exitCode" integer NULL,
        "cols" integer NOT NULL DEFAULT 120,
        "rows" integer NOT NULL DEFAULT 34,
        "runAsRoot" boolean NOT NULL DEFAULT false,
        "retentionExpiresAt" TIMESTAMPTZ NOT NULL,
        "transcriptBytes" bigint NOT NULL DEFAULT 0,
        "chunkCount" integer NOT NULL DEFAULT 0,
        "lastChunkSeq" integer NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_terminal_sessions_id" PRIMARY KEY ("id")
      )
    `);

    await this.dataSource.query(`
      ALTER TABLE "terminal_sessions"
      ADD COLUMN IF NOT EXISTS "runAsRoot" boolean NOT NULL DEFAULT false
    `);

    await this.dataSource.query(`
      CREATE INDEX IF NOT EXISTS "IDX_terminal_sessions_node_created_at"
      ON "terminal_sessions" ("nodeId", "createdAt")
    `);

    await this.dataSource.query(`
      CREATE INDEX IF NOT EXISTS "IDX_terminal_sessions_workspace_created_at"
      ON "terminal_sessions" ("workspaceId", "createdAt")
    `);

    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS "terminal_session_chunks" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "sessionId" uuid NOT NULL,
        "direction" varchar(24) NOT NULL,
        "encoding" varchar(24) NOT NULL DEFAULT 'base64',
        "payload" text NOT NULL,
        "seq" integer NOT NULL,
        "sourceTimestamp" TIMESTAMPTZ NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_terminal_session_chunks_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_terminal_session_chunks_session" FOREIGN KEY ("sessionId") REFERENCES "terminal_sessions"("id") ON DELETE CASCADE
      )
    `);

    await this.dataSource.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_terminal_session_chunks_session_seq"
      ON "terminal_session_chunks" ("sessionId", "seq")
    `);

    await this.dataSource.query(`
      CREATE INDEX IF NOT EXISTS "IDX_terminal_session_chunks_session_created_at"
      ON "terminal_session_chunks" ("sessionId", "createdAt")
    `);

    this.logger.log('Ensured terminal session schema exists');
  }
}
