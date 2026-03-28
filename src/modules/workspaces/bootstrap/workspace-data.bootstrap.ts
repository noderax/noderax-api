import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DEFAULT_TIMEZONE } from '../../../common/utils/timezone.util';
import { INSTALLER_MANAGED_FLAG } from '../../../install/install-state';

const DEFAULT_WORKSPACE_NAME = 'Default Workspace';
const DEFAULT_WORKSPACE_SLUG = 'default';

@Injectable()
export class WorkspaceDataBootstrap implements OnApplicationBootstrap {
  private readonly logger = new Logger(WorkspaceDataBootstrap.name);

  constructor(private readonly dataSource: DataSource) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env[INSTALLER_MANAGED_FLAG] === 'true') {
      this.logger.log(
        'Skipping legacy default workspace migration for installer-managed deployment',
      );
      return;
    }

    const defaultWorkspaceId = await this.ensureDefaultWorkspace();
    await this.ensureDefaultWorkspaceFlag(defaultWorkspaceId);
    await this.promoteLegacyAdmins();
    await this.backfillWorkspaceIds(defaultWorkspaceId);
    await this.ensureDefaultMemberships(defaultWorkspaceId);
    await this.removeInvalidTeamMemberships();
    await this.syncDefaultWorkspaceTimezone(defaultWorkspaceId);
    this.logger.log('Ensured default workspace data migration completed');
  }

  private async ensureDefaultWorkspace(): Promise<string> {
    const existing = await this.findDefaultWorkspaceCandidates();
    const currentDefaultWorkspace = existing.find(
      (workspace) => workspace.isDefault,
    );
    const legacyDefaultSlugWorkspace = existing.find(
      (workspace) => workspace.slug === DEFAULT_WORKSPACE_SLUG,
    );

    if (currentDefaultWorkspace) {
      if (
        legacyDefaultSlugWorkspace &&
        legacyDefaultSlugWorkspace.id !== currentDefaultWorkspace.id
      ) {
        this.logger.warn(
          `Found default workspace "${currentDefaultWorkspace.id}" and legacy "${DEFAULT_WORKSPACE_SLUG}" workspace "${legacyDefaultSlugWorkspace.id}". Preserving the current default workspace.`,
        );
      }

      return currentDefaultWorkspace.id;
    }

    if (legacyDefaultSlugWorkspace) {
      return legacyDefaultSlugWorkspace.id;
    }

    const seededAdmin = (await this.dataSource.query(
      `
        SELECT "id", "timezone"
        FROM "users"
        WHERE "role"::text IN ('platform_admin', 'admin')
        ORDER BY "createdAt" ASC
        LIMIT 1
      `,
    )) as Array<{ id: string; timezone: string | null }>;

    const timezone = seededAdmin[0]?.timezone || DEFAULT_TIMEZONE;
    const rows = (await this.dataSource.query(
      `
        INSERT INTO "workspaces" ("name", "slug", "defaultTimezone", "createdByUserId", "isArchived", "isDefault")
        VALUES ($1, $2, $3, $4, false, true)
        ON CONFLICT DO NOTHING
        RETURNING "id"
      `,
      [
        DEFAULT_WORKSPACE_NAME,
        DEFAULT_WORKSPACE_SLUG,
        timezone,
        seededAdmin[0]?.id ?? null,
      ],
    )) as Array<{ id: string }>;

    if (rows[0]?.id) {
      return rows[0].id;
    }

    const afterInsertAttempt = await this.findDefaultWorkspaceCandidates();
    const recoveredDefaultWorkspace = afterInsertAttempt.find(
      (workspace) => workspace.isDefault,
    );
    const recoveredLegacyWorkspace = afterInsertAttempt.find(
      (workspace) => workspace.slug === DEFAULT_WORKSPACE_SLUG,
    );

    if (recoveredDefaultWorkspace) {
      return recoveredDefaultWorkspace.id;
    }

    if (recoveredLegacyWorkspace) {
      return recoveredLegacyWorkspace.id;
    }

    throw new Error('Unable to resolve a default workspace during bootstrap.');
  }

  private async ensureDefaultWorkspaceFlag(
    defaultWorkspaceId: string,
  ): Promise<void> {
    const existing = (await this.dataSource.query(
      `
        SELECT "id"
        FROM "workspaces"
        WHERE "isDefault" = true
        LIMIT 1
      `,
    )) as Array<{ id: string }>;

    if (existing[0]?.id) {
      return;
    }

    await this.dataSource.query(
      `
        UPDATE "workspaces"
        SET "isDefault" = true
        WHERE "id" = $1
      `,
      [defaultWorkspaceId],
    );
  }

  private async findDefaultWorkspaceCandidates(): Promise<
    Array<{ id: string; slug: string; isDefault: boolean }>
  > {
    return (await this.dataSource.query(
      `
        SELECT "id", "slug", "isDefault"
        FROM "workspaces"
        WHERE "isDefault" = true OR "slug" = $1
        ORDER BY "isDefault" DESC, "createdAt" ASC
      `,
      [DEFAULT_WORKSPACE_SLUG],
    )) as Array<{ id: string; slug: string; isDefault: boolean }>;
  }

  private async promoteLegacyAdmins(): Promise<void> {
    await this.dataSource.query(`
      UPDATE "users"
      SET "role" = 'platform_admin'
      WHERE "role"::text = 'admin'
    `);
  }

  private async backfillWorkspaceIds(
    defaultWorkspaceId: string,
  ): Promise<void> {
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

  private async removeInvalidTeamMemberships(): Promise<void> {
    const invalidMemberships = (await this.dataSource.query(`
      SELECT tm."id"
      FROM "team_memberships" tm
      JOIN "teams" t
        ON t."id" = tm."teamId"
      LEFT JOIN "workspace_memberships" wm
        ON wm."workspaceId" = t."workspaceId"
       AND wm."userId" = tm."userId"
      WHERE wm."id" IS NULL
    `)) as Array<{ id: string }>;

    for (const membership of invalidMemberships) {
      await this.dataSource.query(
        `
          DELETE FROM "team_memberships"
          WHERE "id" = $1
        `,
        [membership.id],
      );
    }
  }
}
