# Noderax API

Noderax is an agent-based infrastructure management platform. This repository contains the monolithic NestJS control plane API used by the web dashboard and remote Go agents.

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
- Agent registration secured with enrollment token
- Metrics ingestion persisted to PostgreSQL
- Task creation, polling, execution updates, and logs
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
- database credentials
- Redis settings if Redis is enabled

`AGENT_ENROLLMENT_TOKEN` is a shared secret used only for initial agent enrollment. It prevents unauthorized servers from registering themselves with the control plane.

If you want the API to create a first admin user automatically, set:

- `SEED_DEFAULT_ADMIN=true`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`

### 3. Run in development

```bash
pnpm start:dev
```

The default API base URL is `http://localhost:3000/api/v1`.
Swagger UI is available at `http://localhost:3000/api/v1/docs`.
OpenAPI JSON is available at `http://localhost:3000/api/v1/docs-json`.

If you want to remove the prefix locally, set `API_PREFIX=` and the API base URL becomes `http://localhost:3000`.

## Docker

```bash
cp .env.example .env
docker compose up --build
```

Services:

- API: `http://localhost:3000`
- PostgreSQL: `localhost:5432`
- Redis: `localhost:6379`

## Production Build

```bash
pnpm build
pnpm start:prod
```

## Environment

All required variables are documented in `.env.example`.

## Main Endpoints

All HTTP routes below are relative to the configured API base URL. With the default `.env`, that base URL is `http://localhost:3000/api/v1`.

### Public

- `GET /health`
- `POST /auth/login`
- `POST /agent/register`
- `POST /agent/heartbeat`
- `POST /agent/metrics`

### Agent-Authenticated

These endpoints are intended for registered agents and require `nodeId` plus `agentToken` in the request body.

- `POST /agent/tasks/pull`
- `POST /agent/tasks/:id/start`
- `POST /agent/tasks/:id/logs`
- `POST /agent/tasks/:id/complete`

### Authenticated

- `GET /users/me`
- `GET /nodes`
- `GET /nodes/:id`
- `GET /metrics`
- `GET /tasks`
- `GET /tasks/:id`
- `GET /events`

### Admin

- `GET /users`
- `POST /users`
- `POST /nodes`
- `DELETE /nodes/:id`

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

### 2. Register an Agent

```bash
curl -X POST http://localhost:3000/api/v1/agent/register \
  -H "Content-Type: application/json" \
  -d '{
    "hostname": "srv-01",
    "os": "ubuntu",
    "arch": "amd64",
    "enrollmentToken": "your-token"
  }'
```

### 3. Send a Heartbeat

```bash
curl -X POST http://localhost:3000/api/v1/agent/heartbeat \
  -H "Content-Type: application/json" \
  -d '{
    "nodeId": "generated-node-id",
    "agentToken": "generated-agent-token"
  }'
```

### 4. Ingest Metrics

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

### 5. Create a Task

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

### 6. Pull Queued Tasks as an Agent

```bash
curl -X POST http://localhost:3000/api/v1/agent/tasks/pull \
  -H "Content-Type: application/json" \
  -d '{
    "nodeId": "generated-node-id",
    "agentToken": "generated-agent-token",
    "limit": 10
  }'
```

### 7. Start and Complete a Task as an Agent

```bash
curl -X POST http://localhost:3000/api/v1/agent/tasks/<task-id>/start \
  -H "Content-Type: application/json" \
  -d '{
    "nodeId": "generated-node-id",
    "agentToken": "generated-agent-token"
  }'
```

```bash
curl -X POST http://localhost:3000/api/v1/agent/tasks/<task-id>/complete \
  -H "Content-Type: application/json" \
  -d '{
    "nodeId": "generated-node-id",
    "agentToken": "generated-agent-token",
    "status": "success",
    "result": {
      "exitCode": 0
    },
    "output": "command completed successfully"
  }'
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

## Notes

- Agent metrics ingestion requires `agentToken` for authentication.
- Agent registration requires a valid `enrollmentToken` shared during initial agent enrollment.
- Redis is optional at runtime. If unavailable, the API still works and logs Redis connection warnings when publish operations are attempted.
- Notifications are stubbed and ready for Telegram or webhook integrations later.
