import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class EnrollmentSchemaBootstrap implements OnModuleInit {
  private readonly logger = new Logger(EnrollmentSchemaBootstrap.name);

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
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

    await this.dataSource.query(`
      ALTER TABLE "nodes"
      ADD COLUMN IF NOT EXISTS "description" text NULL
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
