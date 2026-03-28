import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource, Table } from 'typeorm';
import { DEFAULT_TIMEZONE } from '../../../common/utils/timezone.util';

@Injectable()
export class UserPreferencesSchemaBootstrap implements OnModuleInit {
  private readonly logger = new Logger(UserPreferencesSchemaBootstrap.name);

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    if (!(await this.hasTable('users'))) {
      this.logger.warn(
        'Skipping user timezone preference bootstrap because the users table does not exist yet',
      );
      return;
    }

    await this.dataSource.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "timezone" varchar(80) NOT NULL DEFAULT '${DEFAULT_TIMEZONE}'
    `);

    await this.dataSource.query(`
      ALTER TABLE "users"
      ALTER COLUMN "timezone" TYPE varchar(80)
    `);

    await this.dataSource.query(`
      ALTER TABLE "users"
      ALTER COLUMN "passwordHash" DROP NOT NULL
    `);

    await this.dataSource.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "inviteStatus" varchar(24) NOT NULL DEFAULT 'accepted',
      ADD COLUMN IF NOT EXISTS "lastInvitedAt" TIMESTAMPTZ NULL,
      ADD COLUMN IF NOT EXISTS "activatedAt" TIMESTAMPTZ NULL,
      ADD COLUMN IF NOT EXISTS "criticalEventEmailsEnabled" boolean NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS "enrollmentEmailsEnabled" boolean NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS "sessionVersion" integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "mfaEnabled" boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS "mfaSecretEncrypted" text NULL,
      ADD COLUMN IF NOT EXISTS "mfaPendingSecretEncrypted" text NULL,
      ADD COLUMN IF NOT EXISTS "mfaRecoveryCodes" jsonb NULL,
      ADD COLUMN IF NOT EXISTS "mfaEnabledAt" TIMESTAMPTZ NULL
    `);

    await this.ensureTokenTables();

    this.logger.log('Ensured user timezone preference schema exists');
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

  private async ensureTokenTables(): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();

    try {
      if (!(await queryRunner.hasTable('user_invitations'))) {
        await queryRunner.createTable(
          new Table({
            name: 'user_invitations',
            columns: [
              {
                name: 'id',
                type: 'uuid',
                isPrimary: true,
                default: 'gen_random_uuid()',
              },
              {
                name: 'userId',
                type: 'uuid',
              },
              {
                name: 'tokenLookupHash',
                type: 'varchar',
                length: '64',
              },
              {
                name: 'tokenHash',
                type: 'varchar',
                length: '255',
              },
              {
                name: 'status',
                type: 'varchar',
                length: '24',
                default: "'pending'",
              },
              {
                name: 'createdByUserId',
                type: 'uuid',
                isNullable: true,
              },
              {
                name: 'expiresAt',
                type: 'timestamptz',
              },
              {
                name: 'consumedAt',
                type: 'timestamptz',
                isNullable: true,
              },
              {
                name: 'revokedAt',
                type: 'timestamptz',
                isNullable: true,
              },
              {
                name: 'createdAt',
                type: 'timestamptz',
                default: 'now()',
              },
              {
                name: 'updatedAt',
                type: 'timestamptz',
                default: 'now()',
              },
            ],
          }),
        );
      }

      if (!(await queryRunner.hasTable('password_reset_tokens'))) {
        await queryRunner.createTable(
          new Table({
            name: 'password_reset_tokens',
            columns: [
              {
                name: 'id',
                type: 'uuid',
                isPrimary: true,
                default: 'gen_random_uuid()',
              },
              {
                name: 'userId',
                type: 'uuid',
              },
              {
                name: 'tokenLookupHash',
                type: 'varchar',
                length: '64',
              },
              {
                name: 'tokenHash',
                type: 'varchar',
                length: '255',
              },
              {
                name: 'status',
                type: 'varchar',
                length: '24',
                default: "'pending'",
              },
              {
                name: 'expiresAt',
                type: 'timestamptz',
              },
              {
                name: 'consumedAt',
                type: 'timestamptz',
                isNullable: true,
              },
              {
                name: 'revokedAt',
                type: 'timestamptz',
                isNullable: true,
              },
              {
                name: 'createdAt',
                type: 'timestamptz',
                default: 'now()',
              },
              {
                name: 'updatedAt',
                type: 'timestamptz',
                default: 'now()',
              },
            ],
          }),
        );
      }

      await queryRunner.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS "IDX_user_invitations_lookup_hash"
        ON "user_invitations" ("tokenLookupHash")
      `);

      await queryRunner.query(`
        CREATE INDEX IF NOT EXISTS "IDX_user_invitations_user_status"
        ON "user_invitations" ("userId", "status")
      `);

      await queryRunner.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS "IDX_password_reset_tokens_lookup_hash"
        ON "password_reset_tokens" ("tokenLookupHash")
      `);

      await queryRunner.query(`
        CREATE INDEX IF NOT EXISTS "IDX_password_reset_tokens_user_status"
        ON "password_reset_tokens" ("userId", "status")
      `);

      await queryRunner
        .query(
          `
          ALTER TABLE "user_invitations"
          ADD CONSTRAINT "FK_user_invitations_user"
          FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
        `,
        )
        .catch(() => undefined);

      await queryRunner
        .query(
          `
          ALTER TABLE "password_reset_tokens"
          ADD CONSTRAINT "FK_password_reset_tokens_user"
          FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
        `,
        )
        .catch(() => undefined);
    } finally {
      await queryRunner.release();
    }
  }
}
