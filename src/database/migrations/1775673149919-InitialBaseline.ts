import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialBaseline1775673149919 implements MigrationInterface {
  name = 'InitialBaseline1775673149919';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(
      `CREATE TABLE "audit_logs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "scope" character varying(24) NOT NULL, "workspaceId" uuid, "actorType" character varying(24) NOT NULL DEFAULT 'user', "actorUserId" uuid, "actorEmailSnapshot" character varying(255), "action" character varying(120) NOT NULL, "targetType" character varying(80) NOT NULL, "targetId" character varying(120), "targetLabel" character varying(255), "ipAddress" character varying(120), "userAgent" text, "changes" jsonb, "metadata" jsonb, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_1bb179d048bbc581caa3b013439" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_logs_workspace_created_at" ON "audit_logs" ("workspaceId", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_logs_scope_created_at" ON "audit_logs" ("scope", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "oidc_identities" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "providerId" uuid NOT NULL, "userId" uuid NOT NULL, "subject" character varying(255) NOT NULL, "email" character varying(255) NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_5f2ee4d63e1d0ca3bc5c924dcf4" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_oidc_identities_provider_subject" ON "oidc_identities" ("providerId", "subject") `,
    );
    await queryRunner.query(
      `CREATE TABLE "oidc_providers" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "slug" character varying(80) NOT NULL, "name" character varying(120) NOT NULL, "preset" character varying(40), "issuer" character varying(255) NOT NULL, "clientId" character varying(255) NOT NULL, "clientSecretEncrypted" text, "discoveryUrl" character varying(255) NOT NULL, "scopes" jsonb NOT NULL DEFAULT '["openid","email","profile"]', "enabled" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_9091f59a6b15823091351364407" UNIQUE ("slug"), CONSTRAINT "PK_7e80d1ff5af72ef3fdfba897fd2" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_oidc_providers_enabled" ON "oidc_providers" ("enabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "agent_task_lifecycle_events" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "nodeId" uuid NOT NULL, "taskId" uuid NOT NULL, "eventType" character varying(64) NOT NULL, "eventTimestamp" TIMESTAMP WITH TIME ZONE NOT NULL, "payload" jsonb NOT NULL DEFAULT '{}', "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_680676b9e93368c84007980e45c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_agent_task_lifecycle_idempotency" ON "agent_task_lifecycle_events" ("taskId", "eventType", "eventTimestamp") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_agent_task_lifecycle_task_created" ON "agent_task_lifecycle_events" ("taskId", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "agent_update_rollout_targets" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "rolloutId" uuid NOT NULL, "nodeId" uuid NOT NULL, "workspaceId" uuid NOT NULL, "teamId" uuid, "nodeNameSnapshot" character varying(160) NOT NULL, "previousVersion" character varying(80), "targetVersion" character varying(80) NOT NULL, "status" character varying(32) NOT NULL DEFAULT 'pending', "progressPercent" integer NOT NULL DEFAULT '0', "statusMessage" text, "taskId" uuid, "sequence" integer NOT NULL DEFAULT '0', "dispatchedAt" TIMESTAMP WITH TIME ZONE, "completedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_07938a106e9fd9cf9c326923803" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2a1f8cad49ebc52d698fb0d966" ON "agent_update_rollout_targets" ("rolloutId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_36c41aa4b7890531d04b9918f7" ON "agent_update_rollout_targets" ("nodeId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_734728450a3ab0368d91496dc6" ON "agent_update_rollout_targets" ("workspaceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dcf3e963b07abe72984c845854" ON "agent_update_rollout_targets" ("status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e831d76ec1ac814adb0e4e2f37" ON "agent_update_rollout_targets" ("taskId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dce4fa38a52d65118a4db04e06" ON "agent_update_rollout_targets" ("sequence") `,
    );
    await queryRunner.query(
      `CREATE TABLE "agent_update_rollouts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "targetVersion" character varying(80) NOT NULL, "status" character varying(32) NOT NULL DEFAULT 'queued', "rollback" boolean NOT NULL DEFAULT false, "requestedByUserId" uuid, "requestedByEmailSnapshot" character varying(255), "startedAt" TIMESTAMP WITH TIME ZONE, "completedAt" TIMESTAMP WITH TIME ZONE, "cancelledAt" TIMESTAMP WITH TIME ZONE, "statusMessage" text, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_9fa91881a5468dd2bb7cd157939" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8e3d9938fbc1a4dc3a469d8859" ON "agent_update_rollouts" ("targetVersion") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2ae2f158aff00544ae82b64b24" ON "agent_update_rollouts" ("status") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."enrollment_status_enum" AS ENUM('pending', 'approved', 'revoked')`,
    );
    await queryRunner.query(
      `CREATE TABLE "enrollments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "workspaceId" uuid, "email" character varying(255) NOT NULL, "tokenHash" character varying(255) NOT NULL, "tokenLookupHash" character varying(64) NOT NULL, "hostname" character varying(255) NOT NULL, "additionalInfo" jsonb, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "status" "public"."enrollment_status_enum" NOT NULL DEFAULT 'pending', "nodeId" uuid, "agentToken" text, CONSTRAINT "PK_7c0f752f9fb68bf6ed7367ab00f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bb3e544438ae10971d75bc3258" ON "enrollments" ("workspaceId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_639888850e0bb87f1f5cf29688" ON "enrollments" ("tokenLookupHash") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_85cb449eb3f5b7546f6abe4b73" ON "enrollments" ("expiresAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3816714ab4c719d70e6b848744" ON "enrollments" ("status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_085aceb551d4521b57ba0145b6" ON "enrollments" ("nodeId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "node_installs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "workspaceId" uuid NOT NULL, "teamId" uuid, "nodeName" character varying(120) NOT NULL, "description" text, "tokenHash" character varying(255) NOT NULL, "tokenLookupHash" character varying(64) NOT NULL, "hostname" character varying(255), "additionalInfo" jsonb, "nodeId" uuid, "status" character varying(32) NOT NULL DEFAULT 'pending', "stage" character varying(64) NOT NULL DEFAULT 'command_generated', "progressPercent" integer NOT NULL DEFAULT '5', "statusMessage" text, "startedAt" TIMESTAMP WITH TIME ZONE, "consumedAt" TIMESTAMP WITH TIME ZONE, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_0251f43addbe2d2ba0137bde7a4" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b653980527961459583db63559" ON "node_installs" ("workspaceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_77b49d3af1e7d638a3919c6ae7" ON "node_installs" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_d581f83ecf2af6c7731aad75a9" ON "node_installs" ("tokenLookupHash") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5066ad59f63e29caa7b1813685" ON "node_installs" ("hostname") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4c20b201532cb3a2edac0e6c1f" ON "node_installs" ("nodeId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_eb8cf54f3e784bbb8df614a7a3" ON "node_installs" ("expiresAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "outbox_events" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "type" character varying(120) NOT NULL, "payload" jsonb NOT NULL, "status" character varying(32) NOT NULL DEFAULT 'pending', "attempts" integer NOT NULL DEFAULT '0', "maxAttempts" integer NOT NULL DEFAULT '8', "availableAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "lockedAt" TIMESTAMP WITH TIME ZONE, "lockedBy" character varying(120), "processedAt" TIMESTAMP WITH TIME ZONE, "lastError" text, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_6689a16c00d09b8089f6237f1d2" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_outbox_events_status_available_at" ON "outbox_events" ("status", "availableAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_outbox_events_processed_at" ON "outbox_events" ("processedAt") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."event_severity_enum" AS ENUM('info', 'warning', 'critical')`,
    );
    await queryRunner.query(
      `CREATE TABLE "events" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "workspaceId" uuid NOT NULL, "nodeId" uuid, "type" character varying(120) NOT NULL, "severity" "public"."event_severity_enum" NOT NULL DEFAULT 'info', "message" text NOT NULL, "metadata" jsonb, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_40731c7151fe4be3116e45ddf73" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_87e4848c60e961425a711cc1d6" ON "events" ("workspaceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_780c7720eb3ee9a3509fdd5d09" ON "events" ("nodeId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "incident_analyses" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "incidentId" uuid NOT NULL, "model" character varying(120) NOT NULL, "summary" text NOT NULL, "probableCauses" jsonb NOT NULL DEFAULT '[]'::jsonb, "recommendedChecks" jsonb NOT NULL DEFAULT '[]'::jsonb, "inputTokens" integer, "outputTokens" integer, "estimatedCostUsd" numeric(12,6), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_3d5e20cd7421ab439af0168000b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_incident_analyses_incident_created_at" ON "incident_analyses" ("incidentId", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."incident_severity_enum" AS ENUM('info', 'warning', 'critical')`,
    );
    await queryRunner.query(
      `CREATE TABLE "incidents" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "workspaceId" uuid NOT NULL, "nodeId" uuid NOT NULL, "ruleId" uuid NOT NULL, "sourcePresetId" character varying(64) NOT NULL, "status" character varying(24) NOT NULL DEFAULT 'open', "severity" "public"."incident_severity_enum" NOT NULL DEFAULT 'warning', "title" character varying(255) NOT NULL, "fingerprint" character varying(255) NOT NULL, "firstSeenAt" TIMESTAMP WITH TIME ZONE NOT NULL, "lastSeenAt" TIMESTAMP WITH TIME ZONE NOT NULL, "hitCount" integer NOT NULL DEFAULT '1', "latestSample" jsonb, "latestTaskId" uuid, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_ccb34c01719889017e2246469f9" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_incidents_node_rule_fingerprint_status" ON "incidents" ("nodeId", "ruleId", "fingerprint", "status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_incidents_workspace_status_last_seen" ON "incidents" ("workspaceId", "status", "lastSeenAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "log_monitor_cursors" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "ruleId" uuid NOT NULL, "nodeId" uuid NOT NULL, "sourcePresetId" character varying(64) NOT NULL, "journalCursor" text, "fileInode" text, "fileOffset" bigint, "lastReadAt" TIMESTAMP WITH TIME ZONE, "cursorResetReason" text, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_7d1da027e2def0c419f87c6897d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_log_monitor_cursors_rule_id" ON "log_monitor_cursors" ("ruleId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "log_monitor_rules" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "workspaceId" uuid NOT NULL, "nodeId" uuid NOT NULL, "name" character varying(160) NOT NULL, "enabled" boolean NOT NULL DEFAULT true, "sourcePresetId" character varying(64) NOT NULL, "cadence" character varying(24) NOT NULL DEFAULT 'minutely', "intervalMinutes" smallint NOT NULL DEFAULT '1', "dsl" jsonb NOT NULL, "nextRunAt" TIMESTAMP WITH TIME ZONE, "lastRunAt" TIMESTAMP WITH TIME ZONE, "lastError" text, "lastTaskId" uuid, "leaseUntil" TIMESTAMP WITH TIME ZONE, "claimedBy" character varying(120), "claimToken" uuid, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_7b64a3e6af462b0992ce77078aa" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_log_monitor_rules_enabled_next_run" ON "log_monitor_rules" ("enabled", "nextRunAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_log_monitor_rules_workspace_node" ON "log_monitor_rules" ("workspaceId", "nodeId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "metrics" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "workspaceId" uuid NOT NULL, "nodeId" uuid NOT NULL, "cpuUsage" real NOT NULL, "memoryUsage" real NOT NULL, "diskUsage" real NOT NULL, "temperature" real, "networkStats" jsonb NOT NULL, "recordedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_5283cad666a83376e28a715bf0e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_55a50b9497805456fa5cbcfcf4" ON "metrics" ("workspaceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_08d4a8649d9895e8671a6d6531" ON "metrics" ("nodeId") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."node_status_enum" AS ENUM('online', 'offline')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."node_root_access_profile_enum" AS ENUM('off', 'operational', 'task', 'terminal', 'operational_task', 'operational_terminal', 'task_terminal', 'all')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."node_root_access_sync_status_enum" AS ENUM('pending', 'applied', 'failed')`,
    );
    await queryRunner.query(
      `CREATE TABLE "nodes" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "workspaceId" uuid NOT NULL, "name" character varying(120) NOT NULL, "description" text, "hostname" character varying(255) NOT NULL, "os" character varying(120) NOT NULL, "arch" character varying(64) NOT NULL, "status" "public"."node_status_enum" NOT NULL DEFAULT 'offline', "teamId" uuid, "maintenanceMode" boolean NOT NULL DEFAULT false, "notificationEmailEnabled" boolean NOT NULL DEFAULT true, "notificationEmailLevels" text NOT NULL DEFAULT 'info,warning,critical', "notificationTelegramEnabled" boolean NOT NULL DEFAULT true, "notificationTelegramLevels" text NOT NULL DEFAULT 'info,warning,critical', "rootAccessProfile" "public"."node_root_access_profile_enum" NOT NULL DEFAULT 'off', "rootAccessAppliedProfile" "public"."node_root_access_profile_enum" NOT NULL DEFAULT 'off', "rootAccessSyncStatus" "public"."node_root_access_sync_status_enum" NOT NULL DEFAULT 'pending', "rootAccessUpdatedAt" TIMESTAMP WITH TIME ZONE, "rootAccessUpdatedByUserId" uuid, "rootAccessLastAppliedAt" TIMESTAMP WITH TIME ZONE, "rootAccessLastError" text, "maintenanceReason" text, "maintenanceStartedAt" TIMESTAMP WITH TIME ZONE, "maintenanceByUserId" uuid, "agentVersion" character varying(64), "platformVersion" character varying(120), "kernelVersion" character varying(120), "lastVersionReportedAt" TIMESTAMP WITH TIME ZONE, "lastSeenAt" TIMESTAMP WITH TIME ZONE, "agentTokenHash" character varying, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_682d6427523a0fa43d062ea03ee" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b7a7995260152c818f25becfcc" ON "nodes" ("workspaceId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_d87bce2ae6f48e289cad37bace" ON "nodes" ("hostname") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."user_role_enum" AS ENUM('platform_admin', 'user')`,
    );
    await queryRunner.query(
      `CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "email" character varying(255) NOT NULL, "name" character varying(120) NOT NULL, "role" "public"."user_role_enum" NOT NULL DEFAULT 'user', "passwordHash" character varying, "isActive" boolean NOT NULL DEFAULT true, "timezone" character varying(80) NOT NULL DEFAULT 'UTC', "inviteStatus" character varying(24) NOT NULL DEFAULT 'accepted', "lastInvitedAt" TIMESTAMP WITH TIME ZONE, "activatedAt" TIMESTAMP WITH TIME ZONE, "criticalEventEmailsEnabled" boolean NOT NULL DEFAULT true, "enrollmentEmailsEnabled" boolean NOT NULL DEFAULT true, "sessionVersion" integer NOT NULL DEFAULT '0', "mfaEnabled" boolean NOT NULL DEFAULT false, "mfaSecretEncrypted" text, "mfaPendingSecretEncrypted" text, "mfaRecoveryCodes" jsonb, "mfaEnabledAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."scheduled_task_timezone_source_enum" AS ENUM('workspace', 'legacy_fixed')`,
    );
    await queryRunner.query(
      `CREATE TABLE "scheduled_tasks" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "workspaceId" uuid NOT NULL, "nodeId" uuid, "targetTeamId" uuid, "templateId" uuid, "templateName" character varying(160), "ownerUserId" uuid, "name" character varying(160) NOT NULL, "command" text NOT NULL, "runAsRoot" boolean NOT NULL DEFAULT false, "cadence" character varying(24) NOT NULL, "minute" smallint NOT NULL, "hour" smallint, "dayOfWeek" smallint, "intervalMinutes" smallint, "timezone" character varying(80) NOT NULL DEFAULT 'UTC', "timezoneSource" "public"."scheduled_task_timezone_source_enum" NOT NULL DEFAULT 'legacy_fixed', "enabled" boolean NOT NULL DEFAULT true, "nextRunAt" TIMESTAMP WITH TIME ZONE, "lastRunAt" TIMESTAMP WITH TIME ZONE, "lastRunTaskId" uuid, "lastError" text, "leaseUntil" TIMESTAMP WITH TIME ZONE, "claimedBy" character varying(120), "claimToken" uuid, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_abc9348e8ae95b59b11a982ea87" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_aeefc44888658f88151fa77ed3" ON "scheduled_tasks" ("workspaceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_scheduled_tasks_owner_user" ON "scheduled_tasks" ("ownerUserId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_scheduled_tasks_node_enabled_next_run" ON "scheduled_tasks" ("nodeId", "enabled", "nextRunAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_scheduled_tasks_enabled_next_run" ON "scheduled_tasks" ("enabled", "nextRunAt") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."task_status_enum" AS ENUM('queued', 'accepted', 'claimed', 'running', 'success', 'failed', 'cancelled')`,
    );
    await queryRunner.query(
      `CREATE TABLE "tasks" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "workspaceId" uuid NOT NULL, "nodeId" uuid NOT NULL, "targetTeamId" uuid, "templateId" uuid, "templateName" character varying(160), "type" character varying(120) NOT NULL, "isInternal" boolean NOT NULL DEFAULT false, "payload" jsonb NOT NULL DEFAULT '{}', "status" "public"."task_status_enum" NOT NULL DEFAULT 'queued', "result" jsonb, "output" text, "outputTruncated" boolean DEFAULT false, "leaseUntil" TIMESTAMP WITH TIME ZONE, "claimedBy" uuid, "claimToken" uuid, "startedAt" TIMESTAMP WITH TIME ZONE, "finishedAt" TIMESTAMP WITH TIME ZONE, "cancelRequestedAt" TIMESTAMP WITH TIME ZONE, "cancelReason" text, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_8d12ff38fcc62aaba2cab748772" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f88dbead7aecbf13a1b40f7c88" ON "tasks" ("workspaceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ffac06312cb3708de572a7094b" ON "tasks" ("nodeId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tasks_workspace_created_at" ON "tasks" ("workspaceId", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tasks_node_status_created_at" ON "tasks" ("nodeId", "status", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."task_log_level_enum" AS ENUM('info', 'stdout', 'stderr', 'error')`,
    );
    await queryRunner.query(
      `CREATE TABLE "task_logs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "taskId" uuid NOT NULL, "level" "public"."task_log_level_enum" NOT NULL DEFAULT 'info', "message" text NOT NULL, "timestamp" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_9754457a29b4ffbb772e8a3039c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_363351d7c117f653087c1d7bf2" ON "task_logs" ("taskId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_task_logs_task_created_at" ON "task_logs" ("taskId", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "task_templates" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "workspaceId" uuid NOT NULL, "name" character varying(160) NOT NULL, "description" text, "taskType" character varying(120) NOT NULL, "payloadTemplate" jsonb NOT NULL DEFAULT '{}', "createdByUserId" uuid NOT NULL, "updatedByUserId" uuid NOT NULL, "archivedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_a1347b5446b9e3158e2b72f58b2" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_task_templates_workspace_created_at" ON "task_templates" ("workspaceId", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "terminal_sessions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "workspaceId" uuid NOT NULL, "nodeId" uuid NOT NULL, "createdByUserId" uuid, "createdByEmailSnapshot" character varying(255), "status" character varying(24) NOT NULL DEFAULT 'pending', "openedAt" TIMESTAMP WITH TIME ZONE, "closedAt" TIMESTAMP WITH TIME ZONE, "closedReason" text, "exitCode" integer, "cols" integer NOT NULL DEFAULT '120', "rows" integer NOT NULL DEFAULT '34', "runAsRoot" boolean NOT NULL DEFAULT false, "retentionExpiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "transcriptBytes" bigint NOT NULL DEFAULT '0', "chunkCount" integer NOT NULL DEFAULT '0', "lastChunkSeq" integer NOT NULL DEFAULT '0', "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_10286b807e2224f1183d4d8a774" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_terminal_sessions_workspace_created_at" ON "terminal_sessions" ("workspaceId", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_terminal_sessions_node_created_at" ON "terminal_sessions" ("nodeId", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "terminal_session_chunks" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "sessionId" uuid NOT NULL, "direction" character varying(24) NOT NULL, "encoding" character varying(24) NOT NULL DEFAULT 'base64', "payload" text NOT NULL, "seq" integer NOT NULL, "sourceTimestamp" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_b440471fea0625e17fb6ab8ee29" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_terminal_session_chunks_session_created_at" ON "terminal_session_chunks" ("sessionId", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_terminal_session_chunks_session_seq" ON "terminal_session_chunks" ("sessionId", "seq") `,
    );
    await queryRunner.query(
      `CREATE TABLE "password_reset_tokens" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "tokenLookupHash" character varying(64) NOT NULL, "tokenHash" character varying(255) NOT NULL, "status" character varying(24) NOT NULL DEFAULT 'pending', "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "consumedAt" TIMESTAMP WITH TIME ZONE, "revokedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_d16bebd73e844c48bca50ff8d3d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d6a19d4b4f6c62dcd29daa497e" ON "password_reset_tokens" ("userId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_d306b32eeeeee5f052fc3a6803" ON "password_reset_tokens" ("tokenLookupHash") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_edcad6f2fa92986709a5fe4214" ON "password_reset_tokens" ("status") `,
    );
    await queryRunner.query(
      `CREATE TABLE "user_invitations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "tokenLookupHash" character varying(64) NOT NULL, "tokenHash" character varying(255) NOT NULL, "status" character varying(24) NOT NULL DEFAULT 'pending', "createdByUserId" uuid, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "consumedAt" TIMESTAMP WITH TIME ZONE, "revokedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_c8005acb91c3ce9a7ae581eca8f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4d2a7c49fad8d0160ec24dd11f" ON "user_invitations" ("userId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_c648d9e42480fec0faff3d4371" ON "user_invitations" ("tokenLookupHash") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_245772caab09e629f6e80aaaba" ON "user_invitations" ("status") `,
    );
    await queryRunner.query(
      `CREATE TABLE "team_memberships" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "teamId" uuid NOT NULL, "userId" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_team_memberships_team_user" UNIQUE ("teamId", "userId"), CONSTRAINT "PK_053171f713ec8a2f09ed58f08f7" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_82f21cea02fbb7f7a845135967" ON "team_memberships" ("teamId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_877c10e3c9b8f08221792692af" ON "team_memberships" ("userId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "teams" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "workspaceId" uuid NOT NULL, "name" character varying(120) NOT NULL, "description" text, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_teams_workspace_name" UNIQUE ("workspaceId", "name"), CONSTRAINT "PK_7e5523774a38b08a6236d322403" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3ca5ec3f5558bcfb54c76a1ef2" ON "teams" ("workspaceId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "workspaces" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(160) NOT NULL, "slug" character varying(80) NOT NULL, "defaultTimezone" character varying(80) NOT NULL DEFAULT 'UTC', "createdByUserId" uuid, "isArchived" boolean NOT NULL DEFAULT false, "isDefault" boolean NOT NULL DEFAULT false, "automationEmailEnabled" boolean NOT NULL DEFAULT false, "automationTelegramEnabled" boolean NOT NULL DEFAULT false, "automationTelegramBotToken" character varying(255), "automationTelegramChatId" character varying(255), "automationEmailLevels" text NOT NULL DEFAULT 'critical', "automationTelegramLevels" text NOT NULL DEFAULT 'critical', "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_098656ae401f3e1a4586f47fd8e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_b8e9fe62e93d60089dfc4f175f" ON "workspaces" ("slug") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."workspace_membership_role_enum" AS ENUM('owner', 'admin', 'member', 'viewer')`,
    );
    await queryRunner.query(
      `CREATE TABLE "workspace_memberships" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "workspaceId" uuid NOT NULL, "userId" uuid NOT NULL, "role" "public"."workspace_membership_role_enum" NOT NULL DEFAULT 'member', "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_workspace_memberships_workspace_user" UNIQUE ("workspaceId", "userId"), CONSTRAINT "PK_38b7d40a750229143fda4a1b011" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_75e5adf447e36b703e22f3cea9" ON "workspace_memberships" ("workspaceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1fdcbaf8c3472d03fb615eb089" ON "workspace_memberships" ("userId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "scheduled_tasks" ADD CONSTRAINT "FK_16d0b1fec9a1df94a3146c95252" FOREIGN KEY ("nodeId") REFERENCES "nodes"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "scheduled_tasks" ADD CONSTRAINT "FK_4000a8a0c8512bf5fa81a4bb746" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "task_logs" ADD CONSTRAINT "FK_363351d7c117f653087c1d7bf27" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "terminal_session_chunks" ADD CONSTRAINT "FK_a6a904560927d60b306f59c4198" FOREIGN KEY ("sessionId") REFERENCES "terminal_sessions"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "workspace_memberships" ADD CONSTRAINT "FK_75e5adf447e36b703e22f3cea9e" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "workspace_memberships" ADD CONSTRAINT "FK_1fdcbaf8c3472d03fb615eb0893" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_outbox_events_processed_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_outbox_events_status_available_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "workspace_memberships" DROP CONSTRAINT "FK_1fdcbaf8c3472d03fb615eb0893"`,
    );
    await queryRunner.query(
      `ALTER TABLE "workspace_memberships" DROP CONSTRAINT "FK_75e5adf447e36b703e22f3cea9e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "terminal_session_chunks" DROP CONSTRAINT "FK_a6a904560927d60b306f59c4198"`,
    );
    await queryRunner.query(
      `ALTER TABLE "task_logs" DROP CONSTRAINT "FK_363351d7c117f653087c1d7bf27"`,
    );
    await queryRunner.query(
      `ALTER TABLE "scheduled_tasks" DROP CONSTRAINT "FK_4000a8a0c8512bf5fa81a4bb746"`,
    );
    await queryRunner.query(
      `ALTER TABLE "scheduled_tasks" DROP CONSTRAINT "FK_16d0b1fec9a1df94a3146c95252"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1fdcbaf8c3472d03fb615eb089"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_75e5adf447e36b703e22f3cea9"`,
    );
    await queryRunner.query(`DROP TABLE "workspace_memberships"`);
    await queryRunner.query(
      `DROP TYPE "public"."workspace_membership_role_enum"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b8e9fe62e93d60089dfc4f175f"`,
    );
    await queryRunner.query(`DROP TABLE "workspaces"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3ca5ec3f5558bcfb54c76a1ef2"`,
    );
    await queryRunner.query(`DROP TABLE "teams"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_877c10e3c9b8f08221792692af"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_82f21cea02fbb7f7a845135967"`,
    );
    await queryRunner.query(`DROP TABLE "team_memberships"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_245772caab09e629f6e80aaaba"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c648d9e42480fec0faff3d4371"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4d2a7c49fad8d0160ec24dd11f"`,
    );
    await queryRunner.query(`DROP TABLE "user_invitations"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_edcad6f2fa92986709a5fe4214"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d306b32eeeeee5f052fc3a6803"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d6a19d4b4f6c62dcd29daa497e"`,
    );
    await queryRunner.query(`DROP TABLE "password_reset_tokens"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_terminal_session_chunks_session_seq"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_terminal_session_chunks_session_created_at"`,
    );
    await queryRunner.query(`DROP TABLE "terminal_session_chunks"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_terminal_sessions_node_created_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_terminal_sessions_workspace_created_at"`,
    );
    await queryRunner.query(`DROP TABLE "terminal_sessions"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_task_templates_workspace_created_at"`,
    );
    await queryRunner.query(`DROP TABLE "task_templates"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_task_logs_task_created_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_363351d7c117f653087c1d7bf2"`,
    );
    await queryRunner.query(`DROP TABLE "task_logs"`);
    await queryRunner.query(`DROP TYPE "public"."task_log_level_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_tasks_node_status_created_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_tasks_workspace_created_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ffac06312cb3708de572a7094b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f88dbead7aecbf13a1b40f7c88"`,
    );
    await queryRunner.query(`DROP TABLE "tasks"`);
    await queryRunner.query(`DROP TYPE "public"."task_status_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_scheduled_tasks_enabled_next_run"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_scheduled_tasks_node_enabled_next_run"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_scheduled_tasks_owner_user"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_aeefc44888658f88151fa77ed3"`,
    );
    await queryRunner.query(`DROP TABLE "scheduled_tasks"`);
    await queryRunner.query(
      `DROP TYPE "public"."scheduled_task_timezone_source_enum"`,
    );
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP TYPE "public"."user_role_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d87bce2ae6f48e289cad37bace"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b7a7995260152c818f25becfcc"`,
    );
    await queryRunner.query(`DROP TABLE "nodes"`);
    await queryRunner.query(
      `DROP TYPE "public"."node_root_access_sync_status_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."node_root_access_profile_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."node_status_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_08d4a8649d9895e8671a6d6531"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_55a50b9497805456fa5cbcfcf4"`,
    );
    await queryRunner.query(`DROP TABLE "metrics"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_log_monitor_rules_workspace_node"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_log_monitor_rules_enabled_next_run"`,
    );
    await queryRunner.query(`DROP TABLE "log_monitor_rules"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_log_monitor_cursors_rule_id"`,
    );
    await queryRunner.query(`DROP TABLE "log_monitor_cursors"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_incidents_workspace_status_last_seen"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_incidents_node_rule_fingerprint_status"`,
    );
    await queryRunner.query(`DROP TABLE "incidents"`);
    await queryRunner.query(`DROP TYPE "public"."incident_severity_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_incident_analyses_incident_created_at"`,
    );
    await queryRunner.query(`DROP TABLE "incident_analyses"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_780c7720eb3ee9a3509fdd5d09"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_87e4848c60e961425a711cc1d6"`,
    );
    await queryRunner.query(`DROP TABLE "events"`);
    await queryRunner.query(`DROP TYPE "public"."event_severity_enum"`);
    await queryRunner.query(`DROP TABLE "outbox_events"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_eb8cf54f3e784bbb8df614a7a3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4c20b201532cb3a2edac0e6c1f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5066ad59f63e29caa7b1813685"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d581f83ecf2af6c7731aad75a9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_77b49d3af1e7d638a3919c6ae7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b653980527961459583db63559"`,
    );
    await queryRunner.query(`DROP TABLE "node_installs"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_085aceb551d4521b57ba0145b6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3816714ab4c719d70e6b848744"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_85cb449eb3f5b7546f6abe4b73"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_639888850e0bb87f1f5cf29688"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bb3e544438ae10971d75bc3258"`,
    );
    await queryRunner.query(`DROP TABLE "enrollments"`);
    await queryRunner.query(`DROP TYPE "public"."enrollment_status_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2ae2f158aff00544ae82b64b24"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8e3d9938fbc1a4dc3a469d8859"`,
    );
    await queryRunner.query(`DROP TABLE "agent_update_rollouts"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_dce4fa38a52d65118a4db04e06"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e831d76ec1ac814adb0e4e2f37"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_dcf3e963b07abe72984c845854"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_734728450a3ab0368d91496dc6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_36c41aa4b7890531d04b9918f7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2a1f8cad49ebc52d698fb0d966"`,
    );
    await queryRunner.query(`DROP TABLE "agent_update_rollout_targets"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_agent_task_lifecycle_task_created"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."UQ_agent_task_lifecycle_idempotency"`,
    );
    await queryRunner.query(`DROP TABLE "agent_task_lifecycle_events"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_oidc_providers_enabled"`);
    await queryRunner.query(`DROP TABLE "oidc_providers"`);
    await queryRunner.query(
      `DROP INDEX "public"."UQ_oidc_identities_provider_subject"`,
    );
    await queryRunner.query(`DROP TABLE "oidc_identities"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_audit_logs_scope_created_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_audit_logs_workspace_created_at"`,
    );
    await queryRunner.query(`DROP TABLE "audit_logs"`);
  }
}
