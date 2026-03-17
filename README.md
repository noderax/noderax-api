# Noderax API

Noderax is an agent-based infrastructure management platform. This repository contains the monolithic NestJS control plane API used by the web dashboard and remote Go agents.

## Stack

- NestJS 10
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
    interfaces/
  config/
  database/
  redis/
```

## MVP Features

- JWT login flow with seeded default admin
- User roles: `admin`, `user`
- Node inventory with heartbeat-driven online status
- Agent registration with generated agent token
- Metrics ingestion persisted to PostgreSQL
- Task creation and retrieval
- Event persistence with notification stubs
- Realtime broadcasts for node, metric, task, and event updates

## Quick Start

```bash
pnpm install
cp .env.example .env
pnpm start:dev
```

The API listens on `http://localhost:3000` by default.

## Environment

Key variables are documented in `.env.example`.

Important defaults:

- `SEED_DEFAULT_ADMIN=true`
- `ADMIN_EMAIL=admin@noderax.local`
- `ADMIN_PASSWORD=ChangeMe123!`
- `DB_SYNCHRONIZE=true` for local MVP development

## Main Endpoints

### Public

- `GET /health`
- `POST /auth/login`
- `POST /agent/register`
- `POST /agent/heartbeat`
- `POST /agent/metrics`

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
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@noderax.local",
    "password": "ChangeMe123!"
  }'
```

### 2. Register an Agent

```bash
curl -X POST http://localhost:3000/agent/register \
  -H "Content-Type: application/json" \
  -d '{
    "hostname": "srv-01",
    "os": "ubuntu-24.04",
    "arch": "amd64"
  }'
```

### 3. Send a Heartbeat

```bash
curl -X POST http://localhost:3000/agent/heartbeat \
  -H "Content-Type: application/json" \
  -d '{
    "nodeId": "generated-node-id",
    "agentToken": "generated-agent-token"
  }'
```

### 4. Ingest Metrics

```bash
curl -X POST http://localhost:3000/agent/metrics \
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
curl -X POST http://localhost:3000/tasks \
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

## Realtime

Socket.IO is exposed at the `realtime` namespace.

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
- Redis is optional at runtime. If unavailable, the API still works and logs Redis connection warnings when publish operations are attempted.
- Notifications are stubbed and ready for Telegram or webhook integrations later.
