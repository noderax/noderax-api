import { MigrationInterface, QueryRunner } from 'typeorm';

export class SecurityHardeningNodeAgentRoot1779300000000 implements MigrationInterface {
  name = 'SecurityHardeningNodeAgentRoot1779300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "nodes"
      ADD COLUMN IF NOT EXISTS "rootAccessExpiresAt" TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS "rootAccessReason" text,
      ADD COLUMN IF NOT EXISTS "rootAccessGrantedByUserId" uuid,
      ADD COLUMN IF NOT EXISTS "rootAccessGrantId" uuid,
      ADD COLUMN IF NOT EXISTS "pendingAgentTokenHash" character varying,
      ADD COLUMN IF NOT EXISTS "pendingAgentTokenExpiresAt" TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS "agentTokenRotatedAt" TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS "agentTokenRevokedAt" TIMESTAMP WITH TIME ZONE
    `);

    await queryRunner.query(`
      ALTER TABLE "agent_task_lifecycle_events"
      ADD COLUMN IF NOT EXISTS "eventId" character varying(64),
      ADD COLUMN IF NOT EXISTS "eventSeq" bigint
    `);

    await queryRunner.query(`
      ALTER TABLE "terminal_sessions"
      ADD COLUMN IF NOT EXISTS "rootAccessGrantId" uuid
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_agent_task_lifecycle_node_event_id"
      ON "agent_task_lifecycle_events" ("nodeId", "eventId")
      WHERE "eventId" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_agent_task_lifecycle_node_event_seq"
      ON "agent_task_lifecycle_events" ("nodeId", "eventSeq")
      WHERE "eventSeq" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "UQ_agent_task_lifecycle_node_event_seq"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "UQ_agent_task_lifecycle_node_event_id"',
    );
    await queryRunner.query(`
      ALTER TABLE "agent_task_lifecycle_events"
      DROP COLUMN IF EXISTS "eventSeq",
      DROP COLUMN IF EXISTS "eventId"
    `);
    await queryRunner.query(`
      ALTER TABLE "terminal_sessions"
      DROP COLUMN IF EXISTS "rootAccessGrantId"
    `);
    await queryRunner.query(`
      ALTER TABLE "nodes"
      DROP COLUMN IF EXISTS "agentTokenRevokedAt",
      DROP COLUMN IF EXISTS "agentTokenRotatedAt",
      DROP COLUMN IF EXISTS "pendingAgentTokenExpiresAt",
      DROP COLUMN IF EXISTS "pendingAgentTokenHash",
      DROP COLUMN IF EXISTS "rootAccessGrantId",
      DROP COLUMN IF EXISTS "rootAccessGrantedByUserId",
      DROP COLUMN IF EXISTS "rootAccessReason",
      DROP COLUMN IF EXISTS "rootAccessExpiresAt"
    `);
  }
}
