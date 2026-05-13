import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNodeLocationFields1778587200000
  implements MigrationInterface
{
  name = 'AddNodeLocationFields1778587200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "nodes"
      ADD COLUMN IF NOT EXISTS "locationProvider" character varying(24),
      ADD COLUMN IF NOT EXISTS "locationSource" character varying(40),
      ADD COLUMN IF NOT EXISTS "locationRegion" character varying(80),
      ADD COLUMN IF NOT EXISTS "locationZone" character varying(80),
      ADD COLUMN IF NOT EXISTS "locationLatitude" double precision,
      ADD COLUMN IF NOT EXISTS "locationLongitude" double precision,
      ADD COLUMN IF NOT EXISTS "locationUpdatedAt" TIMESTAMP WITH TIME ZONE
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_nodes_location_provider_region"
      ON "nodes" ("locationProvider", "locationRegion")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_nodes_location_provider_region"`,
    );
    await queryRunner.query(`
      ALTER TABLE "nodes"
      DROP COLUMN IF EXISTS "locationUpdatedAt",
      DROP COLUMN IF EXISTS "locationLongitude",
      DROP COLUMN IF EXISTS "locationLatitude",
      DROP COLUMN IF EXISTS "locationZone",
      DROP COLUMN IF EXISTS "locationRegion",
      DROP COLUMN IF EXISTS "locationSource",
      DROP COLUMN IF EXISTS "locationProvider"
    `);
  }
}
