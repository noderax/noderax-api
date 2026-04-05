# Changelog

## Unreleased

- Added composite node root-access profiles (`operational_task`, `operational_terminal`, `task_terminal`) and applied-surface validation for operational, task, and terminal privileged actions.
- Added immediate agent realtime root-access update dispatch while keeping auth-ack and claim-response fallback delivery paths.
- Added stable diagnostics endpoint `GET /api/v1/diagnostics/task-flow` for frontend task-flow panel observability.
- Added typed diagnostics response contract with default-safe counters and health timestamps.
- Added e2e coverage for auth behavior, response schema/defaults, numeric counter typing, and smoke performance.
- Added platform/kernel version acceptance in enrollment and realtime agent auth flows so node telemetry can refresh after reconnects.
- Added per-node Email and Telegram delivery rules for node-scoped event notifications, including channel toggles, severity filtering, and workspace-master precedence.
- Changed package deletion handling to queue `packagePurge` separately from `packageRemove`.
- Fixed rollout monitoring so active target cancellation is requested deterministically and linked `agent.update` tasks can be reconciled into terminal states.

## 1.0.0 - Stable

Initial stable release of the Noderax control plane API.

Highlights:

- NestJS 11 monolithic control plane for the dashboard and Go agents
- Agent registration, heartbeat, and metrics ingestion
- Full agent task lifecycle: create, pull, start, log, and complete
- Scheduler-driven node online and offline detection
- Realtime Socket.IO updates for nodes, tasks, metrics, and events
- Swagger documentation under the versioned API prefix

Operational notes:

- Default API base URL: `/api/v1`
- Default Swagger UI path: `/api/v1/docs`
- Offline detection is controlled by `AGENT_HEARTBEAT_TIMEOUT_SECONDS`
- Scheduler interval is controlled by `AGENT_OFFLINE_CHECK_INTERVAL_SECONDS`
