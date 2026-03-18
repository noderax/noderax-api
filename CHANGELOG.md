# Changelog

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
