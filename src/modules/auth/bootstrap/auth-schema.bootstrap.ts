import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class AuthSchemaBootstrap implements OnModuleInit {
  private readonly logger = new Logger(AuthSchemaBootstrap.name);

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    if (this.dataSource.options.synchronize) {
      this.logger.debug(
        'Skipping auth schema bootstrap because TypeORM synchronize is enabled',
      );
      return;
    }

    await this.dataSource.query(`
      CREATE EXTENSION IF NOT EXISTS pgcrypto
    `);

    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS "oidc_providers" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "slug" varchar(80) NOT NULL,
        "name" varchar(120) NOT NULL,
        "preset" varchar(40) NULL,
        "issuer" varchar(255) NOT NULL,
        "clientId" varchar(255) NOT NULL,
        "clientSecretEncrypted" text NULL,
        "discoveryUrl" varchar(255) NOT NULL,
        "scopes" jsonb NOT NULL DEFAULT '["openid","email","profile"]'::jsonb,
        "enabled" boolean NOT NULL DEFAULT true,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_oidc_providers_id" PRIMARY KEY ("id")
      )
    `);

    await this.dataSource.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_oidc_providers_slug"
      ON "oidc_providers" ("slug")
    `);

    await this.dataSource.query(`
      CREATE INDEX IF NOT EXISTS "IDX_oidc_providers_enabled"
      ON "oidc_providers" ("enabled")
    `);

    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS "oidc_identities" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "providerId" uuid NOT NULL,
        "userId" uuid NOT NULL,
        "subject" varchar(255) NOT NULL,
        "email" varchar(255) NOT NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_oidc_identities_id" PRIMARY KEY ("id")
      )
    `);

    await this.dataSource.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_oidc_identities_provider_subject"
      ON "oidc_identities" ("providerId", "subject")
    `);

    await this.dataSource
      .query(
        `
        ALTER TABLE "oidc_identities"
        ADD CONSTRAINT "FK_oidc_identities_provider"
        FOREIGN KEY ("providerId") REFERENCES "oidc_providers"("id") ON DELETE CASCADE
      `,
      )
      .catch(() => undefined);

    await this.dataSource
      .query(
        `
        ALTER TABLE "oidc_identities"
        ADD CONSTRAINT "FK_oidc_identities_user"
        FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
      `,
      )
      .catch(() => undefined);

    this.logger.log('Ensured auth schema exists');
  }
}
