import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMetricsWorkspaceRecordedAtIndex1782000000000
  implements MigrationInterface
{
  name = 'AddMetricsWorkspaceRecordedAtIndex1782000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Backs the "latest N metrics for a workspace" query
    // (WHERE "workspaceId" = $1 ORDER BY "recordedAt" DESC LIMIT n).
    // Without it Postgres scans every row for the workspace and sorts them,
    // which times out the web proxy (15s) once the table grows.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_metrics_workspace_recorded_at"
      ON "metrics" ("workspaceId", "recordedAt" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_metrics_workspace_recorded_at"`,
    );
  }
}
