<p align="center">
  <img src="https://raw.githubusercontent.com/noderax/noderax-web/main/public/logo.webp" alt="Noderax logo" width="168" />
</p>
<h1 align="center">Noderax API</h1>

Noderax API is the NestJS control plane for the platform. It serves the web dashboard, the first-run installer, workspace-aware control-plane routes, and the remote Linux-based Go agent runtime.

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
    audit-logs/
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
    terminal-sessions/
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
- Setup-time PostgreSQL, Redis, and optional SMTP validation
- Global user directory with platform-admin-only CRUD
- Invite-only operator onboarding with transactional email delivery
- Forgot/reset password lifecycle and authenticated password change
- TOTP MFA with recovery codes and short-lived MFA challenge tokens
- OIDC provider management with Google, Microsoft, and generic discovery-based SSO
- Workspace-aware control plane with:
  - workspace listing and detail
  - members and teams
  - owner/admin/member/viewer roles
  - default-workspace selection
  - granular notification levels (INFO, WARNING, CRITICAL) for Email and Telegram
  - automated slug generation
  - archive / restore with read-only enforcement
  - protected workspace deletion rules
- Append-only platform and workspace audit logs
- Platform-level admin role: `platform_admin`
- User-centric membership rules:
  - users are created globally first
  - invited users activate through one-time links before they can sign in
  - workspace memberships point to existing accepted active users
  - teams are composed from workspace members only
  - inactive users cannot log in or receive new assignments
- Workspace-scoped unified search for nodes, tasks, schedules, events, members, and teams
- Linux node inventory with online/offline detection, maintenance mode, team ownership, and version telemetry
- Workspace-scoped one-click node bootstrap with short-lived install commands, live install progress tracking, installer consumption, and legacy enrollment compatibility
- Metrics ingestion and node telemetry persistence
- Task creation, team-targeted dispatch, batch dispatch, long-poll task claiming, lifecycle updates, and logs
- Workspace-scoped task templates
- Scheduled task creation with workspace timezone support and team targeting
- Package operations through the shared task pipeline
- Platform settings persistence through installer state, including SMTP settings validation
- Realtime updates for node state, metrics, tasks, events, and node install progress
- Interactive terminal sessions over a dedicated JWT-authenticated Socket.IO namespace
- Terminal transcript persistence with ordered base64 I/O chunks, 7-day retention, and retention cleanup
- Agent realtime terminal bridge for start, input, resize, stop, opened, output, exited, and error events

## Installation

### Local development without Docker

1. Install dependencies:

```bash
pnpm install
```

2. Create the local environment file:

```bash
cp .env.example .env
```

3. Configure the important values:

- `DATABASE_HOST`
- `DATABASE_PORT`
- `DATABASE_USERNAME`
- `DATABASE_PASSWORD`
- `DATABASE_NAME`
- `DATABASE_SSL`
- `REDIS_ENABLED`
- `REDIS_HOST`
- `REDIS_PORT`
- `REDIS_PASSWORD`
- `NODERAX_STATE_DIR`
- `JWT_SECRET`
- `SECRETS_ENCRYPTION_KEY`
- `AGENT_ENROLLMENT_TOKEN`
- `AGENT_PUBLIC_API_URL`
- `AGENT_INSTALL_SCRIPT_URL`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USERNAME`
- `SMTP_PASSWORD`
- `SMTP_FROM_EMAIL`
- `SMTP_FROM_NAME`
- `WEB_APP_URL`

`DATABASE_*` is the preferred naming scheme. Legacy `DB_*` aliases are still supported for backward compatibility.

For installer-managed deployments, `NODERAX_STATE_DIR` should point to a writable application-data path. For Docker, use a mounted path such as `/data/noderax`.

If `SMTP_HOST` is left blank, mail delivery remains disabled. Invite, reset-password, and operational email flows only send when SMTP is configured. In tests, the API uses JSON transport and exposes captured deliveries through the in-memory mailer service.

`AGENT_PUBLIC_API_URL` should point to the externally reachable API origin used by target servers. In installer-managed setups, the setup flow populates this from the system API URL. `AGENT_INSTALL_SCRIPT_URL` controls the installer script URL embedded into the generated node install command.

If you want the API to create the first platform admin automatically, set:

- `SEED_DEFAULT_ADMIN=true`
- `ADMIN_NAME`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`

4. Start the API:

```bash
pnpm start:dev
```

Default URLs:

- Health: `http://localhost:3000/health`
- API base: `http://localhost:3000/api/v1`
- Swagger UI: `http://localhost:3000/api/v1/docs`
- OpenAPI JSON: `http://localhost:3000/api/v1/docs-json`

### Docker development with hot reload

1. Copy the environment template:

```bash
cp .env.example .env
```

2. Review these values in `.env`:

```env
NODE_ENV=development
DATABASE_HOST=postgres
DATABASE_PORT=5432
DATABASE_SSL=false
DATABASE_SYNCHRONIZE=true
DATABASE_LOGGING=false
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=change-this-redis-password
NODERAX_STATE_DIR=/data/noderax
```

3. Start the development stack:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

Available endpoints:

- Health: `http://localhost:3000/health`
- API base: `http://localhost:3000/api/v1`
- Swagger UI: `http://localhost:3000/api/v1/docs`

The development override mounts the source tree, keeps `node_modules` in a named volume, and runs `pnpm run start:dev` for hot reload.

### Docker production

1. Copy the environment template:

```bash
cp .env.example .env
```

2. Set strong production values before booting:

```env
NODE_ENV=production
DATABASE_HOST=postgres
DATABASE_PORT=5432
DATABASE_SSL=false
DATABASE_SYNCHRONIZE=false
DATABASE_LOGGING=false
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=change-this-redis-password
JWT_SECRET=change-this-jwt-secret
SECRETS_ENCRYPTION_KEY=change-this-secrets-key
AGENT_ENROLLMENT_TOKEN=change-this-agent-enrollment-token
NODERAX_STATE_DIR=/data/noderax
```

3. Build and run the production stack:

```bash
docker compose up -d --build
```

Production behavior:

- Only the API is published on `http://localhost:3000`
- PostgreSQL and Redis stay internal to the Docker network
- PostgreSQL data, Redis data, and installer state are persisted in named volumes
- Redis runs with AOF enabled and password protection

### First-time setup flow

On a fresh install, the API starts in `setup` mode. Complete the initial installation through the setup flow exposed under the API base path:

- `GET /api/v1/setup/status`
- `POST /api/v1/setup/validate/postgres`
- `POST /api/v1/setup/validate/redis`
- `POST /api/v1/setup/validate/smtp`
- `POST /api/v1/setup/install`

After installation completes, the normal application surface becomes active.

## Node Bootstrap Flow

- Workspace owners, admins, and platform admins can create one-click install commands through `POST /workspaces/:workspaceId/node-installs`
- The response includes the full `curl | sudo bash` installer command, the public API URL, the installer script URL, the install record ID, and the initial live status payload
- Install tokens are single-use and short-lived
- Install status can be read through `GET /workspaces/:workspaceId/node-installs/:installId`
- The installer reports progress stages through `POST /node-installs/progress`
- Common progress stages include `installer_started`, dependency preparation, binary download, bootstrap, and `service_started`
- Workspace realtime consumers receive `node-install.updated` frames while bootstrap is running
- Target hosts consume the token through `POST /node-installs/consume`
- Legacy `POST /enrollments/initiate` and `GET /enrollments/:token` remain available for backward compatibility

## Installer And State Directory

The installer persists runtime setup into `install-state.json` under `NODERAX_STATE_DIR`.

Important behavior:

- `setup` mode:
  Fresh install. The API exposes setup endpoints under `/api/v1/setup/*` and waits for first-time provisioning.
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
- Teams are no longer organizational only. Nodes can be assigned to teams, and tasks can be broadcast to every eligible node currently owned by a team.

## Audit And Maintenance

- `GET /audit-logs` exposes platform-wide append-only audit entries for platform admins.
- `GET /workspaces/:workspaceId/audit-logs` exposes workspace-scoped audit entries for workspace owners/admins.
- Nodes support maintenance mode with:
  - `POST /nodes/:id/maintenance/enable`
  - `POST /nodes/:id/maintenance/disable`
  - workspace-scoped equivalents under `/workspaces/:workspaceId/nodes/:id/*`

## Interactive Terminal Model

Interactive terminal access is separate from the HTTP task pipeline.

- Live operator traffic uses the dedicated Socket.IO namespace `/terminal`
- Browser events:
  - `terminal.attach`
  - `terminal.input`
  - `terminal.resize`
  - `terminal.terminate`
- Browser receives:
  - `terminal.session.state`
  - `terminal.output`
  - `terminal.closed`
  - `terminal.error`
- Agent-side realtime events:
  - API to agent: `terminal.start`, `terminal.input`, `terminal.resize`, `terminal.stop`
  - agent to API: `terminal.opened`, `terminal.output`, `terminal.exited`, `terminal.error`

REST surface:

- `POST /workspaces/:workspaceId/nodes/:nodeId/terminal-sessions`
- `GET /workspaces/:workspaceId/nodes/:nodeId/terminal-sessions`
- `GET /workspaces/:workspaceId/terminal-sessions/:sessionId`
- `GET /workspaces/:workspaceId/terminal-sessions/:sessionId/chunks`
- `POST /workspaces/:workspaceId/terminal-sessions/:sessionId/terminate`

Current behavior:

- Only `platform_admin` users who are workspace `owner` or `admin` can start sessions
- Archived workspaces cannot start new sessions
- Nodes must be online and reachable through the agent realtime route
- Maintenance mode does not block terminal access
- A live session has a single controller: the creator can interact, others can inspect closed transcripts
- Transcript chunks are stored in order with a unique `(sessionId, seq)` constraint
- Transcript retention is 7 days
- Controller disconnect has a 5-minute reattach grace window before the session is closed
- Termination requests have a backend timeout fallback so sessions do not remain stuck in `terminating` if the remote shell disconnects without a final exit event
- Audit events are written for create, open, terminate request, exit, failure, and transcript retention cleanup
## Security Model

- `POST /auth/login` may return either a normal session token or `requiresMfa=true` with a short-lived challenge token.
- MFA enrollment is QR-compatible through `POST /auth/mfa/setup/initiate`, then confirmed with `POST /auth/mfa/setup/confirm`.
- Recovery code flows are supported through `POST /auth/mfa/recovery/verify` and `POST /auth/mfa/recovery/regenerate`.
- MFA disable requires authenticated confirmation through `DELETE /auth/mfa`.
- OIDC providers are managed through:
  - `GET /auth/providers` for public login buttons
  - `GET /auth/providers/admin`
  - `POST /auth/providers`
  - `PATCH /auth/providers/:providerId`
  - `DELETE /auth/providers/:providerId`
  - `POST /auth/providers/test`
- Public OIDC handoff routes are:
  - `GET /auth/oidc/:provider/start`
  - `GET /auth/oidc/:provider/callback`

## Task Delivery Model

The primary task execution path is HTTP polling.

- Agents long-poll `POST /agent/tasks/claim`
- Agents report lifecycle with:
  - `POST /agent/tasks/:taskId/accepted`
  - `POST /agent/tasks/:taskId/started`
  - `POST /agent/tasks/:taskId/logs`
  - `POST /agent/tasks/:taskId/completed`
- Cancellation is observed through agent control polling

Interactive terminals are the exception to this rule: they are bridged over the agent realtime socket instead of the HTTP claim loop.
- Realtime agent sockets remain active for telemetry and lifecycle support
- Realtime task push exists only as an explicit compatibility mode and is disabled by default

## Main Endpoints

All routes below are relative to `http://localhost:3000/api/v1`.

### Public / Installer

- `GET /health`
- `POST /auth/login`
- `GET /auth/providers`
- `GET /auth/oidc/:provider/start`
- `GET /auth/oidc/:provider/callback`
- `POST /auth/mfa/challenge/verify`
- `POST /auth/mfa/recovery/verify`
- `GET /auth/invitations/:token`
- `POST /auth/invitations/:token/accept`
- `POST /auth/password/forgot`
- `GET /auth/password/reset/:token`
- `POST /auth/password/reset/:token`
- `GET /setup/status`
- `POST /setup/validate/postgres`
- `POST /setup/validate/redis`
- `POST /setup/validate/smtp`
- `POST /setup/install`
- `POST /node-installs/consume`
- `POST /node-installs/progress`
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

### Authenticated Admin / Workspace

- `GET /audit-logs`
- `GET /workspaces/:workspaceId/audit-logs`
- `GET /platform-settings`
- `PATCH /platform-settings`
- `POST /platform-settings/validate/smtp`
- `POST /auth/mfa/setup/initiate`
- `POST /auth/mfa/setup/confirm`
- `POST /auth/mfa/recovery/regenerate`
- `DELETE /auth/mfa`
- `GET /auth/providers/admin`
- `POST /auth/providers`
- `PATCH /auth/providers/:providerId`
- `DELETE /auth/providers/:providerId`
- `POST /auth/providers/test`
- `POST /workspaces/:workspaceId/tasks/teams/:teamId`
- `POST /workspaces/:workspaceId/node-installs`
- `GET /workspaces/:workspaceId/node-installs/:installId`
- `GET /workspaces/:workspaceId/task-templates`
- `POST /workspaces/:workspaceId/task-templates`
- `PATCH /workspaces/:workspaceId/task-templates/:id`
- `DELETE /workspaces/:workspaceId/task-templates/:id`
- `POST /workspaces/:workspaceId/nodes/:id/team`
- `POST /workspaces/:workspaceId/nodes/:id/maintenance/enable`
- `POST /workspaces/:workspaceId/nodes/:id/maintenance/disable`

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
- `node-install.updated`

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
