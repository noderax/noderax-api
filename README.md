<p align="center">
  <img src="https://raw.githubusercontent.com/noderax/noderax-web/main/public/logo.webp" alt="Noderax logo" width="168" />
</p>
<h1 align="center">Noderax API</h1>

Noderax is an agent-based infrastructure management platform. This repository contains the monolithic NestJS control plane API used by the web dashboard and remote Go agents. It provides the REST and realtime communication layer for the entire platform.

Current stable release: `1.0.0`

## Stack

- NestJS 11
- TypeScript
- PostgreSQL with TypeORM
- Redis for pub/sub and future queue work
- JWT authentication
- Socket.IO gateway for realtime updates

## Module Layout

```text
src/
  modules/
    agents/
    auth/
    enrollments/
    events/
    metrics/
    nodes/
    notifications/
    realtime/
    tasks/
    users/
  common/
    decorators/
    filters/
    guards/
    interceptors/
    types/
    utils/
  config/
  database/
  redis/
```

## MVP Features

- JWT login flow with optional seeded default admin
- User roles: `admin`, `user`
- Node inventory with scheduler-driven online and offline status
- Two-step agent enrollment with admin approval plus legacy registration compatibility
- Metrics ingestion persisted to PostgreSQL
- Task creation, polling, execution updates, and logs
- **Realtime node management:** Reboot and Noderax Agent restart actions
- Event persistence with notification stubs
- Realtime broadcasts for node, metric, task, and event updates

## Local Setup

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Set at least these values before real usage:

- `JWT_SECRET`
- `AGENT_ENROLLMENT_TOKEN`
- `AGENT_HEARTBEAT_TIMEOUT_SECONDS`
- `AGENT_OFFLINE_CHECK_INTERVAL_SECONDS`
- database credentials
- Redis settings if Redis is enabled

`AGENT_ENROLLMENT_TOKEN` is the shared secret used only by the legacy `POST /agent/register` flow. The preferred enrollment path is the new two-step `/enrollments/initiate` -> `/enrollments/:token/finalize` -> `/enrollments/:token` flow.
`AGENT_HEARTBEAT_TIMEOUT_SECONDS` controls how long a node may stay silent before the background scheduler marks it offline.
`AGENT_OFFLINE_CHECK_INTERVAL_SECONDS` controls how often the scheduler scans for stale online nodes.

If you want the API to create a first admin user automatically, set:

- `SEED_DEFAULT_ADMIN=true`
- `ADMIN_NAME`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`

### 3. Run in development

```bash
pnpm start:dev
```

The default API base URL is `http://localhost:3000/api/v1`.
Swagger UI is available at `http://localhost:3000/api/v1/docs`.
OpenAPI JSON is available at `http://localhost:3000/api/v1/docs-json`.

Swagger groups package management routes under `Packages` (now using optimized `dpkg -l` parsing for Debian/Ubuntu), the new two-step enrollment routes under `Enrollments`, and marks the legacy `Agents / register` route as deprecated.

## Docker

```bash
cp .env.example .env
docker compose up --build
```

Services:

- API: `http://localhost:3000`
- PostgreSQL: `localhost:5432`
- Redis: `localhost:6379`

## Production Build & Deployment

```bash
pnpm build
pnpm start:prod
```

### Railway Deployment

For Railway or similar PaaS environments:
- The API is configured to bind to `0.0.0.0` natively via `NEST_BIND_ALL=true`.
- Healthchecks are supported via `GET /health`.
- Explicit `express` dependency has been removed to reduce bundle size and improve startup performance.

## Environment

All required variables are documented in `.env.example`.

Important agent settings:

- `AGENT_HEARTBEAT_TIMEOUT_SECONDS`
  Nodes that do not send a heartbeat within this window are marked `offline`.
- `AGENT_OFFLINE_CHECK_INTERVAL_SECONDS`
  Background polling interval for stale-node detection.
- `AGENT_REALTIME_PING_TIMEOUT_SECONDS`
  Realtime socket ping timeout before force-disconnect.
- `AGENT_REALTIME_PING_CHECK_INTERVAL_SECONDS`
  How often realtime ping timeout checks run.
- `AGENT_STALE_TASK_CHECK_INTERVAL_SECONDS`
  How often stale task detector checks for stuck queued/running tasks.
- `AGENT_STALE_QUEUED_TASK_TIMEOUT_SECONDS`
  Mark queued tasks as failed after this many seconds.
- `AGENT_STALE_RUNNING_TASK_TIMEOUT_SECONDS`
  Mark running tasks as failed after this many seconds.
- `AGENT_HIGH_CPU_THRESHOLD`
  Threshold above which CPU usage is considered high.
- `AGENT_ENROLLMENT_TOKEN`
  Shared secret for the legacy one-step `/agent/register` path only.

## Heartbeat Timeout And Offline Detection

The API runs a background scheduler that checks online nodes at the configured interval.

- If `lastSeenAt` is older than `AGENT_HEARTBEAT_TIMEOUT_SECONDS`, the node transitions from `online` to `offline`.
- The transition is emitted once per state change, not on every scheduler tick.
- Each offline transition records a `node.offline` system event and publishes realtime updates.
- The next valid heartbeat moves the node back to `online`, updates `lastSeenAt`, and records a `node.online` event.

## Main Endpoints

All HTTP routes below are relative to `http://localhost:3000/api/v1`.

### Public

- `GET /health`
- `POST /auth/login`
- `POST /enrollments/initiate`
- `GET /enrollments/:token`
- `POST /agent/register` (legacy, deprecated)
- `POST /agent/heartbeat`
- `POST /agent/metrics`

### Agent-Authenticated

These endpoints are intended for registered agents and require `nodeId` plus `agentToken` in the request body.

- `POST /agent/tasks/claim`
- `POST /agent/tasks/:taskId/accepted`
- `GET /agent/tasks/:taskId/control`
- `POST /agent/tasks/:taskId/started`
- `POST /agent/tasks/:taskId/logs`
- `POST /agent/tasks/:taskId/completed`

### Diagnostics (Admin JWT)

- `GET /diagnostics/task-flow`

Returns a stable diagnostics snapshot for the frontend task-flow panel.

Example response:

```json
{
  "fetchedAt": "2026-03-23T12:34:56.000Z",
  "source": "agent-task-flow",
  "agentCounters": {
    "metrics.ingested": 12345,
    "connection.opened": 87
  },
  "claimCounters": {
    "task.claim.attempted": 340,
    "task.claim.succeeded": 320,
    "task.claim.failed": 20,
    "task.claim.emptyPoll": 140
  },
  "queue": {
    "queued": 12,
    "running": 5
  },
  "health": {
    "realtimeConnected": true,
    "lastAgentSeenAt": "2026-03-23T12:34:50.000Z",
    "lastClaimAt": "2026-03-23T12:34:49.000Z"
  }
}
```

Claim counter semantics:

- `task.claim.attempted`: Claim poll requests received.
- `task.claim.succeeded`: Claim requests that returned a task.
- `task.claim.failed`: Claim failures (authorization + internal errors).
- `task.claim.emptyPoll`: Claim requests that returned no task.

## Agent Task API Contract

All agent task routes authenticate with `nodeId` and `agentToken` in the JSON body.

### Claim queued tasks

`POST /agent/tasks/claim`

Request body:

```json
{
  "nodeId": "generated-node-id",
  "agentToken": "generated-agent-token",
  "limit": 10
}
```

Response body:

```json
{
  "tasks": [
    {
      "id": "task-id",
      "nodeId": "generated-node-id",
      "type": "shell.exec",
      "status": "queued",
      "payload": {
        "command": "hostname"
      }
    }
  ]
}
```

### Start a task

`POST /agent/tasks/:taskId/started`

Request body:

```json
{
  "nodeId": "generated-node-id",
  "agentToken": "generated-agent-token",
  "taskId": "task-id",
  "startedAt": "2026-03-18T10:18:00.000Z"
}
```

### Append task logs

`POST /agent/tasks/:taskId/logs`

Supported request bodies:

Legacy single-message payload:

```json
{
  "nodeId": "generated-node-id",
  "agentToken": "generated-agent-token",
  "message": "running docker ps"
}
```

Go-agent batched payload:

```json
{
  "nodeId": "generated-node-id",
  "agentToken": "generated-agent-token",
  "taskId": "task-id",
  "entries": [
    {
      "stream": "stdout",
      "line": "container-a",
      "timestamp": "2026-03-18T10:18:05.000Z"
    }
  ]
}
```

### Complete a task

`POST /agent/tasks/:taskId/completed`

Request body:

```json
{
  "nodeId": "generated-node-id",
  "agentToken": "generated-agent-token",
  "taskId": "task-id",
  "status": "success",
  "exitCode": 0,
  "durationMs": 7032,
  "completedAt": "2026-03-18T10:19:10.000Z",
  "result": {
    "rowsAffected": 4
  },
  "output": "command completed successfully"
}
```

### Authenticated

- `GET /users/me`
- `GET /nodes`
- `GET /nodes/:id`
- `GET /nodes/:id/packages`
- `GET /packages/search`
- `GET /metrics`
- `GET /tasks`
- `GET /tasks/:id`
- `GET /events`

### Admin

- `GET /users`
- `POST /users`
- `POST /enrollments/:token/finalize`
- `POST /nodes`
- `POST /nodes/:id/packages`
- `DELETE /nodes/:id/packages/:name`
- `DELETE /nodes/:id`
- `POST /tasks`
- `POST /tasks/:id/cancel`

## Two-Step Enrollment API

The preferred agent bootstrap flow is now enrollment-based. The raw enrollment token is returned only once to the agent, while the API stores a salted `tokenHash` plus a deterministic `tokenLookupHash` for secure lookup and verification.

- `POST /enrollments/initiate`
  Public. Creates a short-lived pending enrollment for `{ "email": "...", "hostname": "...", "additionalInfo": { ... } }` and returns `{ "token": "...", "expiresAt": "..." }`.
- `POST /enrollments/:token/finalize`
  Admin-only. Verifies the token and email, creates the node, issues a fresh `agentToken`, and returns `{ "nodeId": "...", "agentToken": "..." }`.
- `GET /enrollments/:token`
  Public. Returns `{ "status": "pending" }`, `{ "status": "revoked" }`, or `{ "status": "approved", "nodeId": "...", "agentToken": "..." }`.

Pending enrollment tokens expire after 15 minutes. Finalization is single-use: approved or revoked tokens can no longer transition state. Swagger documents these routes at `http://localhost:3000/api/v1/docs` under the `Enrollments` tag, including public versus admin access rules and token-expiry behavior.

## Package Management API

Package management is task-backed so the web UI can reuse the existing task and log streams.

- `GET /nodes/:id/packages`
  Queues a `packageList` task, waits up to 10 seconds, and returns a structured package list on success. If the task is still `queued` or `running`, the API falls back to `202 Accepted` with a task envelope.
- `GET /packages/search?nodeId=<node-id>&term=<query>`
  Queues a `packageSearch` task with `{ "term": "<query>" }`. Debian documents apt search behavior against package names and descriptions in [apt(8)](https://manpages.debian.org/experimental/apt/apt.8.en.html), and related apt-cache output includes package metadata plus a short description in [apt-cache(8)](https://manpages.debian.org/testing/apt/apt-cache.8.en.html).
- `POST /nodes/:id/packages`
  Admin-only. Queues a `packageInstall` task with `{ "names": [...], "purge": false }` and immediately returns `202 Accepted`.
- `DELETE /nodes/:id/packages/:name?purge=true`
  Admin-only. Queues `packageRemove` or `packagePurge`. Debian documents that `remove` leaves configuration files in place while `purge` removes them too in [apt-get(8)](https://manpages.debian.org/experimental/apt/apt-get.8.en.html).

Read responses include `taskId` and `taskStatus` so the UI can pivot to `GET /tasks/:id` and `GET /tasks/:id/logs` when needed.
Swagger documents these endpoints at `http://localhost:3000/api/v1/docs` under the `Packages` section, including the admin-only RBAC notes and the `200` versus `202` response behavior for read routes.

## Example Flow

### 1. Login

```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "ChangeMe123!"
  }'
```

### 2. Initiate Agent Enrollment

```bash
curl -X POST http://localhost:3000/api/v1/enrollments/initiate \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "hostname": "srv-01",
    "additionalInfo": {
      "os": "ubuntu",
      "arch": "amd64",
      "agentVersion": "dev"
    }
  }'
```

Response:

```json
{
  "token": "short-lived-enrollment-token",
  "expiresAt": "2026-03-19T14:15:00.000Z"
}
```

### 3. Finalize Enrollment In The Web App

```bash
curl -X POST http://localhost:3000/api/v1/enrollments/short-lived-enrollment-token/finalize \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <admin-jwt>" \
  -d '{
    "email": "admin@example.com",
    "nodeName": "Production Node EU-1",
    "description": "Primary web node"
  }'
```

### 4. Poll Enrollment Status From The Agent

```bash
curl http://localhost:3000/api/v1/enrollments/short-lived-enrollment-token
```

Approved response:

```json
{
  "status": "approved",
  "nodeId": "generated-node-id",
  "agentToken": "generated-agent-token"
}
```

### 5. Send a Heartbeat

```bash
curl -X POST http://localhost:3000/api/v1/agent/heartbeat \
  -H "Content-Type: application/json" \
  -d '{
    "nodeId": "generated-node-id",
    "agentToken": "generated-agent-token"
  }'
```

### 6. Ingest Metrics

```bash
curl -X POST http://localhost:3000/api/v1/agent/metrics \
  -H "Content-Type: application/json" \
  -d '{
    "nodeId": "generated-node-id",
    "agentToken": "generated-agent-token",
    "cpuUsage": 74.2,
    "memoryUsage": 63.1,
    "diskUsage": 48.9,
    "networkStats": {
      "rxBytes": 124000,
      "txBytes": 98000
    }
  }'
```

### 7. Create a Task

```bash
curl -X POST http://localhost:3000/api/v1/tasks \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <jwt>" \
  -d '{
    "nodeId": "generated-node-id",
    "type": "shell.exec",
    "payload": {
      "command": "docker ps"
    }
  }'
```

### 8. Claim Queued Tasks as an Agent

```bash
curl -X POST http://localhost:3000/api/v1/agent/tasks/claim \
  -H "Content-Type: application/json" \
  -d '{
    "nodeId": "generated-node-id",
    "agentToken": "generated-agent-token",
    "limit": 10
  }'
```

### 9. Start and Complete a Task as an Agent

```bash
curl -X POST http://localhost:3000/api/v1/agent/tasks/<task-id>/started \
  -H "Content-Type: application/json" \
  -d '{
    "nodeId": "generated-node-id",
    "agentToken": "generated-agent-token",
    "taskId": "<task-id>",
    "startedAt": "2026-03-18T10:18:00.000Z"
  }'
```

```bash
curl -X POST http://localhost:3000/api/v1/agent/tasks/<task-id>/logs \
  -H "Content-Type: application/json" \
  -d '{
    "nodeId": "generated-node-id",
    "agentToken": "generated-agent-token",
    "entries": [
      {
        "stream": "stdout",
        "line": "docker ps completed",
        "timestamp": "2026-03-18T10:18:05.000Z"
      }
    ]
  }'
```

```bash
curl -X POST http://localhost:3000/api/v1/agent/tasks/<task-id>/completed \
  -H "Content-Type: application/json" \
  -d '{
    "nodeId": "generated-node-id",
    "agentToken": "generated-agent-token",
    "status": "success",
    "taskId": "<task-id>",
    "exitCode": 0,
    "durationMs": 7032,
    "completedAt": "2026-03-18T10:19:10.000Z",
    "result": {
      "exitCode": 0
    },
    "output": "command completed successfully"
  }'
```

### 8. List Installed Packages

```bash
curl -X GET "http://localhost:3000/api/v1/nodes/generated-node-id/packages" \
  -H "Authorization: Bearer <jwt>"
```

If the agent finishes the `packageList` task within the wait window, the response body looks like:

```json
{
  "taskId": "task-id",
  "taskStatus": "success",
  "nodeId": "generated-node-id",
  "operation": "packageList",
  "names": [],
  "purge": null,
  "term": null,
  "packages": [
    {
      "name": "nginx",
      "version": "1.24.0-2ubuntu7",
      "architecture": "amd64",
      "description": "small, powerful, scalable web/proxy server"
    }
  ],
  "error": null
}
```

### 9. Queue a Package Install

```bash
curl -X POST http://localhost:3000/api/v1/nodes/generated-node-id/packages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <jwt>" \
  -d '{
    "names": ["nginx", "curl"],
    "purge": false
  }'
```

Response body:

```json
{
  "taskId": "task-id",
  "taskStatus": "queued",
  "nodeId": "generated-node-id",
  "operation": "packageInstall",
  "names": ["nginx", "curl"],
  "purge": false,
  "term": null
}
```

### 10. Search Packages

```bash
curl -X GET "http://localhost:3000/api/v1/packages/search?nodeId=generated-node-id&term=nginx" \
  -H "Authorization: Bearer <jwt>"
```

Successful response body:

```json
{
  "taskId": "task-id",
  "taskStatus": "success",
  "nodeId": "generated-node-id",
  "operation": "packageSearch",
  "names": [],
  "purge": null,
  "term": "nginx",
  "results": [
    {
      "name": "nginx",
      "version": "1.24.0-2ubuntu7",
      "description": "small, powerful, scalable web/proxy server"
    }
  ],
  "error": null
}
```

### 11. Remove or Purge a Package

```bash
curl -X DELETE "http://localhost:3000/api/v1/nodes/generated-node-id/packages/nginx?purge=true" \
  -H "Authorization: Bearer <jwt>"
```

Accepted response body:

```json
{
  "taskId": "task-id",
  "taskStatus": "queued",
  "nodeId": "generated-node-id",
  "operation": "packagePurge",
  "names": ["nginx"],
  "purge": true,
  "term": null
}
```

## Realtime

Socket.IO is exposed separately at the `realtime` namespace and does not use the HTTP API prefix.

- Connect to `/realtime`
- Subscribe to node-specific events with `subscribe.node`
- Published events include:
  - `node.status.updated`
  - `metrics.ingested`
  - `task.created`
  - `task.updated`
  - `event.created`

Realtime behavior around heartbeat timeouts:

- When the offline scheduler marks a node stale, clients receive `node.status.updated`.
- The related persisted system event is also broadcast through `event.created` with type `node.offline`.
- When a heartbeat brings the node back, clients receive another `node.status.updated` and a `node.online` system event.

## Notes

- Agent metrics ingestion requires `agentToken` for authentication.
- Agent registration requires a valid `enrollmentToken` shared during initial agent enrollment.
- Redis is optional at runtime. If unavailable, the API still works and logs Redis connection warnings when publish operations are attempted.
- Notifications are stubbed and ready for Telegram or webhook integrations later.
