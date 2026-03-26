import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DEFAULT_TIMEZONE } from '../../../common/utils/timezone.util';

const DEFAULT_WORKSPACE_NAME = 'Default Workspace';
const DEFAULT_WORKSPACE_SLUG = 'default';

@Injectable()
export class WorkspaceDataBootstrap implements OnApplicationBootstrap {
  private readonly logger = new Logger(WorkspaceDataBootstrap.name);

  constructor(private readonly dataSource: DataSource) {}

  async onApplicationBootstrap(): Promise<void> {
    const defaultWorkspaceId = await this.ensureDefaultWorkspace();
    await this.promoteLegacyAdmins();
    await this.backfillWorkspaceIds(defaultWorkspaceId);
    await this.ensureDefaultMemberships(defaultWorkspaceId);
    await this.syncDefaultWorkspaceTimezone(defaultWorkspaceId);
    this.logger.log('Ensured default workspace data migration completed');
  }

  private async ensureDefaultWorkspace(): Promise<string> {
    const existing = (await this.dataSource.query(
      `
        SELECT "id"
        FROM "workspaces"
        WHERE "slug" = $1
        LIMIT 1
      `,
      [DEFAULT_WORKSPACE_SLUG],
    )) as Array<{ id: string }>;

    if (existing[0]?.id) {
      return existing[0].id;
    }

    const seededAdmin = (await this.dataSource.query(
      `
        SELECT "id", "timezone"
        FROM "users"
        WHERE "role" IN ('platform_admin', 'admin')
        ORDER BY "createdAt" ASC
        LIMIT 1
      `,
    )) as Array<{ id: string; timezone: string | null }>;

    const timezone = seededAdmin[0]?.timezone || DEFAULT_TIMEZONE;
    const rows = (await this.dataSource.query(
      `
        INSERT INTO "workspaces" ("name", "slug", "defaultTimezone", "createdByUserId", "isArchived")
        VALUES ($1, $2, $3, $4, false)
        RETURNING "id"
      `,
      [
        DEFAULT_WORKSPACE_NAME,
        DEFAULT_WORKSPACE_SLUG,
        timezone,
        seededAdmin[0]?.id ?? null,
      ],
    )) as Array<{ id: string }>;

    return rows[0].id;
  }

  private async promoteLegacyAdmins(): Promise<void> {
    await this.dataSource.query(`
      UPDATE "users"
      SET "role" = 'platform_admin'
      WHERE "role" = 'admin'
    `);
  }

  private async backfillWorkspaceIds(defaultWorkspaceId: string): Promise<void> {
    const targets = [
      'nodes',
      'tasks',
      'events',
      'metrics',
      'scheduled_tasks',
      'enrollments',
    ] as const;

    for (const tableName of targets) {
      await this.dataSource.query(
        `
          UPDATE "${tableName}"
          SET "workspaceId" = $1
          WHERE "workspaceId" IS NULL
        `,
        [defaultWorkspaceId],
      );
    }

    await this.dataSource.query(`
      UPDATE "scheduled_tasks"
      SET "timezoneSource" = 'legacy_fixed'
      WHERE "timezoneSource" IS NULL
         OR "timezoneSource" <> 'workspace'
    `);
  }

  private async ensureDefaultMemberships(
    defaultWorkspaceId: string,
  ): Promise<void> {
    const users = (await this.dataSource.query(`
      SELECT "id", "role"
      FROM "users"
    `)) as Array<{ id: string; role: string }>;

    for (const user of users) {
      await this.dataSource.query(
        `
          INSERT INTO "workspace_memberships" ("workspaceId", "userId", "role")
          VALUES ($1, $2, $3)
          ON CONFLICT ("workspaceId", "userId") DO NOTHING
        `,
        [
          defaultWorkspaceId,
          user.id,
          user.role === 'platform_admin' ? 'owner' : 'member',
        ],
      );
    }
  }

  private async syncDefaultWorkspaceTimezone(
    defaultWorkspaceId: string,
  ): Promise<void> {
    const seededAdmin = (await this.dataSource.query(
      `
        SELECT u."timezone"
        FROM "users" u
        JOIN "workspace_memberships" wm
          ON wm."userId" = u."id"
         AND wm."workspaceId" = $1
         AND wm."role" = 'owner'
        ORDER BY u."createdAt" ASC
        LIMIT 1
      `,
      [defaultWorkspaceId],
    )) as Array<{ timezone: string | null }>;

    await this.dataSource.query(
      `
        UPDATE "workspaces"
        SET "defaultTimezone" = $2
        WHERE "id" = $1
      `,
      [defaultWorkspaceId, seededAdmin[0]?.timezone ?? DEFAULT_TIMEZONE],
    );
  }
}
