<p align="center">
  <img src="https://raw.githubusercontent.com/noderax/noderax-web/main/public/logo.webp" alt="Noderax logo" width="168" />
</p>
<h1 align="center">Noderax API</h1>

Noderax API is the NestJS control plane for the platform. It serves the web dashboard, the first-run installer, workspace-aware control-plane routes, and the remote Go agent runtime.

Current stable release: `1.0.0`

## Stack

- NestJS 11
- TypeScript
- PostgreSQL with TypeORM
- Redis for pub/sub and bridge work
- JWT authentication
- Socket.IO gateways for web and agent realtime

## Module Layout

```text
src/
  modules/
    agent-realtime/
    agents/
    auth/
    diagnostics/
    enrollments/
    events/
    metrics/
    nodes/
    notifications/
    packages/
    platform-settings/
    realtime/
    setup/
    tasks/
    users/
    workspaces/
  common/
  config/
  database/
  install/
  redis/
```

## Platform Surface

- Installer-managed first-run setup with `setup`, `installed`, `legacy`, and `restart_required` modes
- Global user directory with platform-admin-only CRUD
- Invite-only operator onboarding with transactional email delivery
- Forgot/reset password lifecycle and authenticated password change
- Workspace-aware control plane with:
  - workspace listing and detail
  - members and teams
  - owner/admin/member/viewer roles
  - default-workspace selection
  - archive / restore with read-only enforcement
  - protected workspace deletion rules
- Platform-level admin role: `platform_admin`
- User-centric membership rules:
  - users are created globally first
  - invited users activate through one-time links before they can sign in
  - workspace memberships point to existing accepted active users
  - teams are composed from workspace members only
  - inactive users cannot log in or receive new assignments
- Workspace-scoped unified search for nodes, tasks, schedules, events, members, and teams
- Node inventory with online and offline detection
- Agent enrollment with approval flow plus legacy registration compatibility
- Metrics ingestion and node telemetry persistence
- Task creation, batch dispatch, long-poll task claiming, lifecycle updates, and logs
- Scheduled task creation with workspace timezone support
- Package operations through the shared task pipeline
- Platform settings persistence through installer state
- Realtime updates for node state, metrics, tasks, and events

## Local Setup

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Important values:

- `JWT_SECRET`
- `DB_HOST`
- `DB_PORT`
- `DB_USERNAME`
- `DB_PASSWORD`
- `DB_NAME`
- `REDIS_ENABLED`
- `REDIS_HOST`
- `REDIS_PORT`
- `NODERAX_STATE_DIR`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USERNAME`
- `SMTP_PASSWORD`
- `SMTP_FROM_EMAIL`
- `SMTP_FROM_NAME`

For installer-managed deployments, `NODERAX_STATE_DIR` should point to a writable application-data path. For Docker, use a mounted path such as `/data/noderax`.

Invite and password-reset flows now require mail delivery to be configured. In tests, the API uses JSON transport and exposes captured deliveries through the in-memory mailer service.

If you want the API to create the first platform admin automatically, set:

- `SEED_DEFAULT_ADMIN=true`
- `ADMIN_NAME`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`

### 3. Run in development

```bash
pnpm start:dev
```

Default URLs:

- API base: `http://localhost:3000/api/v1`
- Swagger UI: `http://localhost:3000/api/v1/docs`
- OpenAPI JSON: `http://localhost:3000/api/v1/docs-json`

## Docker

```bash
cp .env.example .env
```

Recommended `.env` values for the bundled compose stack:

```env
NODE_ENV=production
DB_SYNCHRONIZE=false
NODERAX_STATE_DIR=/data/noderax
```

Then run:

```bash
docker compose up --build
```

Services:

- API: `http://localhost:3000`
- PostgreSQL: `localhost:5432`
- Redis: `localhost:6379`

The provided `docker-compose.yml` mounts a named volume for installer state at `/data/noderax`.

## Installer And State Directory

The installer persists runtime setup into `install-state.json` under `NODERAX_STATE_DIR`.

Important behavior:

- `setup` mode:
  Fresh install. The API exposes `/setup/*` and waits for first-time provisioning.
- `installed` mode:
  The installer has completed and the normal app surface is active.
- `restart_required` mode:
  Installer-managed settings were updated and a restart is needed before they fully apply.
- `legacy` mode:
  Existing schema and env-driven installs continue to boot without installer ownership.

If the state directory is not writable, setup and platform-settings flows will warn or fail. In containers, use a writable mounted directory instead of writing under a read-only application path.

## Roles And Workspace Model

- Platform role:
  - `platform_admin`
  - `user`
- Workspace membership roles:
  - `owner`
  - `admin`
  - `member`
  - `viewer`

Key rules:

- `platform_admin` can create workspaces, manage platform settings, and manage global users.
- Workspace `owner` and `admin` can update workspace settings, assign existing users as members, manage teams, and delete the workspace.
- Archived workspaces remain readable, but mutations, enrollment finalization, and schedule execution are blocked until restore.
- The current default workspace cannot be deleted until another workspace is selected as default.
- The current default workspace cannot be archived until another workspace becomes default.
- Workspace member creation is reference-based: `POST /workspaces/:workspaceId/members` accepts `userId` plus role.
- Team membership creation is constrained to active users who already belong to the same workspace.
- Removing a workspace membership also removes that user from teams inside the same workspace.
- Deleting a user is blocked while that user still owns workspace memberships, team memberships, or scheduled tasks.

## User, Member, And Team Model

- `Users` is the single source of truth for operator identities.
- `POST /users` creates a pending invited user and dispatches a one-time activation email.
- `POST /users/:userId/resend-invite` rotates the prior invite token and sends a fresh activation email.
- `GET /auth/invitations/:token` and `POST /auth/invitations/:token/accept` power account activation.
- `POST /auth/password/forgot`, `GET /auth/password/reset/:token`, and `POST /auth/password/reset/:token` power the reset flow.
- `POST /users/me/password` changes the authenticated password.
- `GET /users` remains platform-admin only.
- `GET /workspaces/:workspaceId/assignable-users` returns active users not yet attached to the workspace, for workspace `owner` and `admin` plus platform admins.
- `PATCH /users/:userId` supports profile, role, and active-state updates with last-active-admin protections.
- `DELETE /users/:userId` performs hard delete only when the user has no blocking assignments.
- Session invalidation is version-based. Invite accept, password reset, password change, deactivate, and role-sensitive mutations rotate `sessionVersion`.
- Bootstrap now repairs orphaned team memberships that no longer have a matching workspace membership.

## Task Delivery Model

The primary task execution path is HTTP polling.

- Agents long-poll `POST /agent/tasks/claim`
- Agents report lifecycle with:
  - `POST /agent/tasks/:taskId/accepted`
  - `POST /agent/tasks/:taskId/started`
  - `POST /agent/tasks/:taskId/logs`
  - `POST /agent/tasks/:taskId/completed`
- Cancellation is observed through agent control polling
- Realtime agent sockets remain active for telemetry and lifecycle support
- Realtime task push exists only as an explicit compatibility mode and is disabled by default

## Main Endpoints

All routes below are relative to `http://localhost:3000/api/v1`.

### Public / Installer

- `GET /health`
- `POST /auth/login`
- `GET /auth/invitations/:token`
- `POST /auth/invitations/:token/accept`
- `POST /auth/password/forgot`
- `GET /auth/password/reset/:token`
- `POST /auth/password/reset/:token`
- `GET /setup/status`
- `POST /setup/validate/postgres`
- `POST /setup/validate/redis`
- `POST /setup/install`
- `POST /enrollments/initiate`
- `GET /enrollments/:token`

### Agent

- `POST /agent/register` (legacy)
- `POST /agent/heartbeat`
- `POST /agent/metrics`
- `POST /agent/tasks/claim`
- `POST /agent/tasks/:taskId/accepted`
- `GET /agent/tasks/:taskId/control`
- `POST /agent/tasks/:taskId/started`
- `POST /agent/tasks/:taskId/logs`
- `POST /agent/tasks/:taskId/completed`

### Authenticated Control Plane

- `GET /users`
- `GET /users/me`
- `POST /users`
- `POST /users/:userId/resend-invite`
- `PATCH /users/:userId`
- `DELETE /users/:userId`
- `PATCH /users/me/preferences`
- `POST /users/me/password`
- `GET /workspaces`
- `GET /workspaces/:workspaceId`
- `GET /workspaces/:workspaceId/members`
- `GET /workspaces/:workspaceId/assignable-users`
- `GET /workspaces/:workspaceId/search`
- `GET /workspaces/:workspaceId/teams`
- `GET /workspaces/:workspaceId/teams/:teamId/members`
- `GET /workspaces/:workspaceId/nodes`
- `GET /workspaces/:workspaceId/tasks`
- `GET /workspaces/:workspaceId/scheduled-tasks`
- `GET /workspaces/:workspaceId/events`
- `GET /workspaces/:workspaceId/metrics`
- `GET /workspaces/:workspaceId/nodes/:id/packages`

### Admin Surfaces

- `POST /workspaces`
- `PATCH /workspaces/:workspaceId`
- `DELETE /workspaces/:workspaceId`
- `POST /workspaces/:workspaceId/members`
- `PATCH /workspaces/:workspaceId/members/:membershipId`
- `DELETE /workspaces/:workspaceId/members/:membershipId`
- `POST /workspaces/:workspaceId/teams`
- `PATCH /workspaces/:workspaceId/teams/:teamId`
- `DELETE /workspaces/:workspaceId/teams/:teamId`
- `GET /platform-settings`
- `PATCH /platform-settings`

### Diagnostics

- `GET /diagnostics/task-flow`

Returns claim, realtime, and queue-health counters for the web diagnostics panel.

## Realtime Behavior

The API publishes web-facing realtime events for:

- `node.status.updated`
- `metrics.ingested`
- `task.created`
- `task.updated`
- `event.created`

It also hosts the agent realtime namespace at `/agent-realtime`.

## Verification

Recommended checks:

```bash
pnpm build
pnpm lint
pnpm test
pnpm test:e2e
```

## Notes

- The bundled installer and platform-settings flows are designed for writable persistent storage.
- Workspace-scoped routes are the primary surface for the current web app.
- Legacy env-driven installs are still supported, but new installs should prefer the setup flow.
