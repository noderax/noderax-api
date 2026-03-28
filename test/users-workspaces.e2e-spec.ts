import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as request from 'supertest';
import { apiPath } from './helpers/api-path';
import { createE2eApp } from './helpers/e2e-app.factory';

jest.setTimeout(90_000);

function configureTestEnv() {
  process.env.NODE_ENV = 'test';
  process.env.PORT = '0';
  process.env.API_PREFIX = 'api/v1';
  process.env.CORS_ORIGIN = '*';
  process.env.SWAGGER_ENABLED = 'false';
  process.env.SWAGGER_PATH = 'docs';

  process.env.DB_HOST = '127.0.0.1';
  process.env.DB_PORT = '5432';
  process.env.DB_USERNAME = 'postgres';
  process.env.DB_PASSWORD = 'postgres';
  process.env.DB_NAME = 'noderax_test';
  process.env.DB_SYNCHRONIZE = 'true';
  process.env.DB_LOGGING = 'false';
  process.env.DB_SSL = 'false';

  process.env.REDIS_ENABLED = 'false';
  process.env.REDIS_URL = '';
  process.env.REDIS_HOST = '127.0.0.1';
  process.env.REDIS_PORT = '6379';
  process.env.REDIS_PASSWORD = '';
  process.env.REDIS_DB = '0';
  process.env.REDIS_KEY_PREFIX = 'noderax-test:';

  process.env.JWT_SECRET = 'test-secret';
  process.env.JWT_EXPIRES_IN = '1d';
  process.env.BCRYPT_SALT_ROUNDS = '10';

  process.env.AGENT_HEARTBEAT_TIMEOUT_SECONDS = '1';
  process.env.AGENT_OFFLINE_CHECK_INTERVAL_SECONDS = '1';
  process.env.AGENT_ENROLLMENT_TOKEN = 'secret-enrollment-token';
  process.env.AGENT_HIGH_CPU_THRESHOLD = '90';

  process.env.SEED_DEFAULT_ADMIN = 'true';
  process.env.ADMIN_NAME = 'E2E Admin';
  process.env.ADMIN_EMAIL = 'admin@example.com';
  process.env.ADMIN_PASSWORD = 'ChangeMe123!';
}

describe('Users and Workspaces (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let adminToken: string;
  let adminUserId: string;
  let workspaceId: string;
  let teamId: string;
  let nodeId: string;

  const createUser = async (
    email: string,
    overrides?: {
      name?: string;
      role?: 'platform_admin' | 'user';
      password?: string;
    },
  ) => {
    const response = await request(app.getHttpServer())
      .post(apiPath('/users'))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email,
        name: overrides?.name ?? email.split('@')[0],
        password: overrides?.password ?? 'ChangeMe123!',
        role: overrides?.role ?? 'user',
      })
      .expect(201);

    return response.body as {
      id: string;
      email: string;
      name: string;
      role: string;
      isActive: boolean;
    };
  };

  const login = async (email: string, password = 'ChangeMe123!') => {
    const response = await request(app.getHttpServer())
      .post(apiPath('/auth/login'))
      .send({
        email,
        password,
      })
      .expect(200);

    return response.body.accessToken as string;
  };

  beforeAll(async () => {
    configureTestEnv();
    app = await createE2eApp();
    dataSource = app.get(DataSource);

    const adminLogin = await request(app.getHttpServer())
      .post(apiPath('/auth/login'))
      .send({
        email: process.env.ADMIN_EMAIL,
        password: process.env.ADMIN_PASSWORD,
      })
      .expect(200);

    adminToken = adminLogin.body.accessToken;
    adminUserId = adminLogin.body.user.id;

    const workspacesResponse = await request(app.getHttpServer())
      .get(apiPath('/workspaces'))
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    workspaceId = workspacesResponse.body[0].id;
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('blocks last active platform admin mutations', async () => {
    await request(app.getHttpServer())
      .patch(apiPath(`/users/${adminUserId}`))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: false })
      .expect(409);

    await request(app.getHttpServer())
      .patch(apiPath(`/users/${adminUserId}`))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'user' })
      .expect(409);

    await request(app.getHttpServer())
      .delete(apiPath(`/users/${adminUserId}`))
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(409);
  });

  it('creates, updates, activates, and deletes users through admin endpoints', async () => {
    const editableUser = await createUser('editable@example.com', {
      name: 'Editable User',
    });

    await request(app.getHttpServer())
      .patch(apiPath(`/users/${editableUser.id}`))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Editable User Updated',
        email: 'editable.updated@example.com',
        role: 'user',
        isActive: false,
      })
      .expect(200)
      .expect(({ body }) => {
        expect(body.name).toBe('Editable User Updated');
        expect(body.email).toBe('editable.updated@example.com');
        expect(body.isActive).toBe(false);
      });

    await request(app.getHttpServer())
      .post(apiPath('/auth/login'))
      .send({
        email: 'editable.updated@example.com',
        password: 'ChangeMe123!',
      })
      .expect(401);

    await request(app.getHttpServer())
      .patch(apiPath(`/users/${editableUser.id}`))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: true })
      .expect(200)
      .expect(({ body }) => {
        expect(body.isActive).toBe(true);
      });

    await request(app.getHttpServer())
      .delete(apiPath(`/users/${editableUser.id}`))
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({
          deleted: true,
          id: editableUser.id,
        });
      });
  });

  it('prevents inactive users from logging in', async () => {
    const inactiveUser = await createUser('inactive@example.com', {
      name: 'Inactive User',
    });

    await request(app.getHttpServer())
      .patch(apiPath(`/users/${inactiveUser.id}`))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: false })
      .expect(200);

    await request(app.getHttpServer())
      .post(apiPath('/auth/login'))
      .send({
        email: inactiveUser.email,
        password: 'ChangeMe123!',
      })
      .expect(401);
  });

  it('lets workspace admins list assignable users and blocks normal members', async () => {
    const memberUser = await createUser('member@example.com', {
      name: 'Workspace Member',
    });
    const candidateUser = await createUser('candidate@example.com', {
      name: 'Workspace Candidate',
    });

    await request(app.getHttpServer())
      .post(apiPath(`/workspaces/${workspaceId}/members`))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        userId: memberUser.id,
        role: 'member',
      })
      .expect(201);

    await request(app.getHttpServer())
      .get(apiPath(`/workspaces/${workspaceId}/assignable-users`))
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: candidateUser.id,
              email: candidateUser.email,
            }),
          ]),
        );
        expect(
          body.some((user: { id: string }) => user.id === memberUser.id),
        ).toBe(false);
      });

    const memberToken = await login(memberUser.email);

    await request(app.getHttpServer())
      .get(apiPath(`/workspaces/${workspaceId}/assignable-users`))
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(403);
  });

  it('adds workspace members only from existing active users', async () => {
    const activeUser = await createUser('active-member@example.com', {
      name: 'Active Member',
    });
    const inactiveUser = await createUser('inactive-member@example.com', {
      name: 'Inactive Member',
    });

    await request(app.getHttpServer())
      .patch(apiPath(`/users/${inactiveUser.id}`))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: false })
      .expect(200);

    await request(app.getHttpServer())
      .post(apiPath(`/workspaces/${workspaceId}/members`))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        userId: activeUser.id,
        role: 'viewer',
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body.userId).toBe(activeUser.id);
        expect(body.userIsActive).toBe(true);
      });

    await request(app.getHttpServer())
      .post(apiPath(`/workspaces/${workspaceId}/members`))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        userId: inactiveUser.id,
        role: 'member',
      })
      .expect(400);

    await request(app.getHttpServer())
      .post(apiPath(`/workspaces/${workspaceId}/members`))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        userId: activeUser.id,
        role: 'member',
      })
      .expect(409);
  });

  it('adds only active workspace members to teams and removes team memberships when workspace membership is removed', async () => {
    const teamActiveUser = await createUser('team-active@example.com', {
      name: 'Team Active User',
    });
    const teamInactiveUser = await createUser('team-inactive@example.com', {
      name: 'Team Inactive User',
    });

    const activeMembership = await request(app.getHttpServer())
      .post(apiPath(`/workspaces/${workspaceId}/members`))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        userId: teamActiveUser.id,
        role: 'member',
      })
      .expect(201);

    const inactiveMembership = await request(app.getHttpServer())
      .post(apiPath(`/workspaces/${workspaceId}/members`))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        userId: teamInactiveUser.id,
        role: 'member',
      })
      .expect(201);

    await request(app.getHttpServer())
      .patch(apiPath(`/users/${teamInactiveUser.id}`))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: false })
      .expect(200);

    const teamResponse = await request(app.getHttpServer())
      .post(apiPath(`/workspaces/${workspaceId}/teams`))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Platform Ops',
        description: 'Workspace owners',
      })
      .expect(201);

    teamId = teamResponse.body.id;

    await request(app.getHttpServer())
      .post(apiPath(`/workspaces/${workspaceId}/teams/${teamId}/members`))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        userId: teamActiveUser.id,
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body.userIsActive).toBe(true);
      });

    await request(app.getHttpServer())
      .post(apiPath(`/workspaces/${workspaceId}/teams/${teamId}/members`))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        userId: teamInactiveUser.id,
      })
      .expect(400);

    await request(app.getHttpServer())
      .get(apiPath(`/workspaces/${workspaceId}/teams/${teamId}/members`))
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              userId: teamActiveUser.id,
              userIsActive: true,
            }),
          ]),
        );
      });

    await request(app.getHttpServer())
      .delete(
        apiPath(
          `/workspaces/${workspaceId}/members/${activeMembership.body.id}`,
        ),
      )
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .get(apiPath(`/workspaces/${workspaceId}/teams/${teamId}/members`))
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(
          body.some(
            (membership: { userId: string }) =>
              membership.userId === teamActiveUser.id,
          ),
        ).toBe(false);
      });

    await request(app.getHttpServer())
      .delete(
        apiPath(
          `/workspaces/${workspaceId}/members/${inactiveMembership.body.id}`,
        ),
      )
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
  });

  it('blocks deleting users with workspace memberships, team memberships, or owned scheduled tasks', async () => {
    const workspaceAssignedUser = await createUser(
      'workspace-only@example.com',
      {
        name: 'Workspace Only User',
      },
    );

    await request(app.getHttpServer())
      .post(apiPath(`/workspaces/${workspaceId}/members`))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        userId: workspaceAssignedUser.id,
        role: 'member',
      })
      .expect(201);

    await request(app.getHttpServer())
      .delete(apiPath(`/users/${workspaceAssignedUser.id}`))
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(409);

    const teamOnlyUser = await createUser('team-only@example.com', {
      name: 'Team Only User',
    });

    await dataSource.query(
      `
        INSERT INTO "team_memberships" ("teamId", "userId")
        VALUES ($1, $2)
      `,
      [teamId, teamOnlyUser.id],
    );

    await request(app.getHttpServer())
      .delete(apiPath(`/users/${teamOnlyUser.id}`))
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(409);

    const scheduleOwner = await createUser('schedule-owner@example.com', {
      name: 'Schedule Owner',
    });

    const scheduleMembership = await request(app.getHttpServer())
      .post(apiPath(`/workspaces/${workspaceId}/members`))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        userId: scheduleOwner.id,
        role: 'admin',
      })
      .expect(201);

    const scheduleOwnerToken = await login(scheduleOwner.email);

    const nodeResponse = await request(app.getHttpServer())
      .post(apiPath(`/workspaces/${workspaceId}/nodes`))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Workspace Node',
        hostname: 'workspace-node-01',
        os: 'ubuntu',
        arch: 'amd64',
      })
      .expect(201);

    nodeId = nodeResponse.body.id;

    await request(app.getHttpServer())
      .post(apiPath(`/workspaces/${workspaceId}/scheduled-tasks`))
      .set('Authorization', `Bearer ${scheduleOwnerToken}`)
      .send({
        nodeId,
        name: 'Health Check',
        command: 'hostname',
        cadence: 'hourly',
        minute: 10,
      })
      .expect(201);

    await request(app.getHttpServer())
      .delete(
        apiPath(
          `/workspaces/${workspaceId}/members/${scheduleMembership.body.id}`,
        ),
      )
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .delete(apiPath(`/users/${scheduleOwner.id}`))
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(409);
  });
});
