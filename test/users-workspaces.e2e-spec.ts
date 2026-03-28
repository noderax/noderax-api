import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as request from 'supertest';
import { EventsService } from '../src/modules/events/events.service';
import { EventSeverity } from '../src/modules/events/entities/event-severity.enum';
import { MailerService } from '../src/modules/notifications/mailer.service';
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
  process.env.WEB_APP_URL = 'http://localhost:3001';
}

type UserResponse = {
  id: string;
  email: string;
  name: string;
  role: 'platform_admin' | 'user';
  isActive: boolean;
  inviteStatus: 'pending' | 'accepted' | 'revoked';
};

describe('Users and Workspaces (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let mailerService: MailerService;
  let eventsService: EventsService;
  let adminToken: string;
  let adminUserId: string;
  let workspaceId: string;
  let teamId: string;

  const defaultPassword = 'ChangeMe123!';

  const findLatestDelivery = (email: string, subjectIncludes?: string) => {
    const delivery = [...mailerService.getDeliveries()]
      .reverse()
      .find(
        (item) =>
          item.to.includes(email) &&
          (!subjectIncludes || item.subject.includes(subjectIncludes)),
      );

    if (!delivery) {
      throw new Error(`No email delivery found for ${email}`);
    }

    return delivery;
  };

  const extractTokenFromDelivery = (
    email: string,
    pathSegment: '/invite/' | '/reset-password/',
    subjectIncludes?: string,
  ) => {
    const delivery = findLatestDelivery(email, subjectIncludes);
    const url = delivery.text
      .split(/\s+/)
      .find((part) => part.includes(pathSegment));

    if (!url) {
      throw new Error(`No ${pathSegment} URL found for ${email}`);
    }

    const pathname = new URL(url).pathname;
    const token = pathname.split('/').filter(Boolean).at(-1);

    if (!token) {
      throw new Error(`Unable to parse token from ${url}`);
    }

    return token;
  };

  const acceptInvitation = async (
    token: string,
    password = defaultPassword,
  ) => {
    await request(app.getHttpServer())
      .post(apiPath(`/auth/invitations/${token}/accept`))
      .send({ password })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({ success: true });
      });
  };

  const createUser = async (
    email: string,
    overrides?: {
      name?: string;
      role?: 'platform_admin' | 'user';
    },
  ) => {
    const response = await request(app.getHttpServer())
      .post(apiPath('/users'))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email,
        name: overrides?.name ?? email.split('@')[0],
        role: overrides?.role ?? 'user',
      })
      .expect(201);

    return response.body as UserResponse;
  };

  const createAcceptedUser = async (
    email: string,
    overrides?: {
      name?: string;
      role?: 'platform_admin' | 'user';
      password?: string;
    },
  ) => {
    const user = await createUser(email, overrides);
    const password = overrides?.password ?? defaultPassword;
    const invitationToken = extractTokenFromDelivery(email, '/invite/');

    await request(app.getHttpServer())
      .get(apiPath(`/auth/invitations/${invitationToken}`))
      .expect(200)
      .expect(({ body }) => {
        expect(body.email).toBe(email);
      });

    await acceptInvitation(invitationToken, password);

    return {
      ...user,
      inviteStatus: 'accepted' as const,
      isActive: true,
      password,
    };
  };

  const login = async (email: string, password = defaultPassword) => {
    const response = await request(app.getHttpServer())
      .post(apiPath('/auth/login'))
      .send({
        email,
        password,
      })
      .expect(200);

    return response.body.accessToken as string;
  };

  const createWorkspace = async (name: string, slug: string) => {
    const response = await request(app.getHttpServer())
      .post(apiPath('/workspaces'))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name,
        slug,
        defaultTimezone: 'UTC',
      })
      .expect(201);

    return response.body as {
      id: string;
      slug: string;
      name: string;
      isArchived: boolean;
      isDefault: boolean;
    };
  };

  const createWorkspaceNode = async (
    targetWorkspaceId: string,
    name: string,
    hostname: string,
  ) => {
    const response = await request(app.getHttpServer())
      .post(apiPath(`/workspaces/${targetWorkspaceId}/nodes`))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name,
        hostname,
        os: 'ubuntu',
        arch: 'amd64',
      })
      .expect(201);

    return response.body as {
      id: string;
      name: string;
    };
  };

  beforeAll(async () => {
    configureTestEnv();
    app = await createE2eApp();
    dataSource = app.get(DataSource);
    mailerService = app.get(MailerService);
    eventsService = app.get(EventsService);

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

  beforeEach(() => {
    mailerService.clearDeliveries();
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

  it('creates invited users, rejects inline passwords, and keeps pending users out of assignments', async () => {
    await request(app.getHttpServer())
      .post(apiPath('/users'))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: 'legacy-inline@example.com',
        name: 'Legacy Inline',
        password: defaultPassword,
      })
      .expect(400);

    const invitedUser = await createUser('pending-invite@example.com', {
      name: 'Pending Invite',
    });

    expect(invitedUser.isActive).toBe(false);
    expect(invitedUser.inviteStatus).toBe('pending');
    expect(
      findLatestDelivery(invitedUser.email, 'invited to Noderax'),
    ).toBeDefined();

    await request(app.getHttpServer())
      .post(apiPath('/auth/login'))
      .send({
        email: invitedUser.email,
        password: defaultPassword,
      })
      .expect(401);

    await request(app.getHttpServer())
      .post(apiPath(`/workspaces/${workspaceId}/members`))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        userId: invitedUser.id,
        role: 'member',
      })
      .expect(400);

    await request(app.getHttpServer())
      .get(apiPath(`/workspaces/${workspaceId}/assignable-users`))
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(
          body.some((user: { id: string }) => user.id === invitedUser.id),
        ).toBe(false);
      });

    await request(app.getHttpServer())
      .patch(apiPath(`/users/${invitedUser.id}`))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: true })
      .expect(409);
  });

  it('resends invitations and invalidates older invite tokens', async () => {
    const user = await createUser('resend-invite@example.com', {
      name: 'Resend Invite',
    });
    const firstToken = extractTokenFromDelivery(user.email, '/invite/');

    const resendResponse = await request(app.getHttpServer())
      .post(apiPath(`/users/${user.id}/resend-invite`))
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(resendResponse.body.sent).toBe(true);

    const secondToken = extractTokenFromDelivery(user.email, '/invite/');
    expect(secondToken).not.toBe(firstToken);

    await request(app.getHttpServer())
      .get(apiPath(`/auth/invitations/${firstToken}`))
      .expect(410);

    await request(app.getHttpServer())
      .post(apiPath(`/auth/invitations/${firstToken}/accept`))
      .send({ password: defaultPassword })
      .expect(410);

    await acceptInvitation(secondToken);

    await request(app.getHttpServer())
      .post(apiPath('/auth/login'))
      .send({
        email: user.email,
        password: defaultPassword,
      })
      .expect(200);
  });

  it('accepts invitations, supports admin updates, and invalidates sessions on auth-sensitive changes', async () => {
    const editableUser = await createAcceptedUser('editable@example.com', {
      name: 'Editable User',
    });
    const originalToken = await login(editableUser.email);

    await request(app.getHttpServer())
      .patch(apiPath(`/users/${editableUser.id}`))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Editable User Updated',
        email: 'editable.updated@example.com',
        role: 'platform_admin',
      })
      .expect(200)
      .expect(({ body }) => {
        expect(body.name).toBe('Editable User Updated');
        expect(body.email).toBe('editable.updated@example.com');
        expect(body.role).toBe('platform_admin');
      });

    await request(app.getHttpServer())
      .get(apiPath('/users/me'))
      .set('Authorization', `Bearer ${originalToken}`)
      .expect(401);

    await request(app.getHttpServer())
      .post(apiPath('/auth/login'))
      .send({
        email: 'editable.updated@example.com',
        password: defaultPassword,
      })
      .expect(200);

    await request(app.getHttpServer())
      .patch(apiPath(`/users/${editableUser.id}`))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: false })
      .expect(200)
      .expect(({ body }) => {
        expect(body.isActive).toBe(false);
      });

    await request(app.getHttpServer())
      .post(apiPath('/auth/login'))
      .send({
        email: 'editable.updated@example.com',
        password: defaultPassword,
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

  it('handles password reset and authenticated password change with session invalidation', async () => {
    const user = await createAcceptedUser('password-flow@example.com', {
      name: 'Password Flow',
    });
    const initialToken = await login(user.email, user.password);

    mailerService.clearDeliveries();

    await request(app.getHttpServer())
      .post(apiPath('/auth/password/forgot'))
      .send({ email: 'missing@example.com' })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({ success: true });
      });

    expect(mailerService.getDeliveries()).toHaveLength(0);

    await request(app.getHttpServer())
      .post(apiPath('/auth/password/forgot'))
      .send({ email: user.email })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({ success: true });
      });

    const resetToken = extractTokenFromDelivery(
      user.email,
      '/reset-password/',
      'Reset your Noderax password',
    );

    await request(app.getHttpServer())
      .get(apiPath(`/auth/password/reset/${resetToken}`))
      .expect(200)
      .expect(({ body }) => {
        expect(body.email).toBe(user.email);
      });

    await request(app.getHttpServer())
      .post(apiPath(`/auth/password/reset/${resetToken}`))
      .send({ password: 'ResetPass123!' })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({ success: true });
      });

    await request(app.getHttpServer())
      .post(apiPath('/auth/login'))
      .send({
        email: user.email,
        password: user.password,
      })
      .expect(401);

    await request(app.getHttpServer())
      .get(apiPath('/users/me'))
      .set('Authorization', `Bearer ${initialToken}`)
      .expect(401);

    const resetSessionToken = await login(user.email, 'ResetPass123!');

    await request(app.getHttpServer())
      .post(apiPath('/users/me/password'))
      .set('Authorization', `Bearer ${resetSessionToken}`)
      .send({
        currentPassword: 'ResetPass123!',
        newPassword: 'ChangedPass123!',
      })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({ success: true });
      });

    await request(app.getHttpServer())
      .post(apiPath('/auth/login'))
      .send({
        email: user.email,
        password: 'ResetPass123!',
      })
      .expect(401);

    await request(app.getHttpServer())
      .get(apiPath('/users/me'))
      .set('Authorization', `Bearer ${resetSessionToken}`)
      .expect(401);

    await request(app.getHttpServer())
      .post(apiPath('/auth/login'))
      .send({
        email: user.email,
        password: 'ChangedPass123!',
      })
      .expect(200);
  });

  it('lets workspace admins list assignable users and blocks normal members', async () => {
    const memberUser = await createAcceptedUser('member@example.com', {
      name: 'Workspace Member',
    });
    const candidateUser = await createAcceptedUser('candidate@example.com', {
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

    const memberToken = await login(memberUser.email, memberUser.password);

    await request(app.getHttpServer())
      .get(apiPath(`/workspaces/${workspaceId}/assignable-users`))
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(403);
  });

  it('adds workspace members only from existing active accepted users', async () => {
    const activeUser = await createAcceptedUser('active-member@example.com', {
      name: 'Active Member',
    });
    const pendingUser = await createUser('pending-member@example.com', {
      name: 'Pending Member',
    });
    const inactiveUser = await createAcceptedUser(
      'inactive-member@example.com',
      {
        name: 'Inactive Member',
      },
    );

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
        userId: pendingUser.id,
        role: 'member',
      })
      .expect(400);

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

  it('adds only active accepted workspace members to teams and removes team memberships when workspace membership is removed', async () => {
    const teamActiveUser = await createAcceptedUser('team-active@example.com', {
      name: 'Team Active User',
    });
    const teamInactiveUser = await createAcceptedUser(
      'team-inactive@example.com',
      {
        name: 'Team Inactive User',
      },
    );

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
    const workspaceAssignedUser = await createAcceptedUser(
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

    const scheduleOwner = await createAcceptedUser(
      'schedule-owner@example.com',
      {
        name: 'Schedule Owner',
      },
    );

    const scheduleMembership = await request(app.getHttpServer())
      .post(apiPath(`/workspaces/${workspaceId}/members`))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        userId: scheduleOwner.id,
        role: 'admin',
      })
      .expect(201);

    const scheduleOwnerToken = await login(
      scheduleOwner.email,
      scheduleOwner.password,
    );
    const node = await createWorkspaceNode(
      workspaceId,
      'Workspace Node',
      'workspace-node-01',
    );

    await request(app.getHttpServer())
      .post(apiPath(`/workspaces/${workspaceId}/scheduled-tasks`))
      .set('Authorization', `Bearer ${scheduleOwnerToken}`)
      .send({
        nodeId: node.id,
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

  it('delivers transactional emails regardless of preferences and honors operational email preferences', async () => {
    const prefsUser = await createAcceptedUser('prefs-user@example.com', {
      name: 'Prefs User',
    });
    const prefsUserToken = await login(prefsUser.email, prefsUser.password);

    await request(app.getHttpServer())
      .patch(apiPath('/users/me/preferences'))
      .set('Authorization', `Bearer ${prefsUserToken}`)
      .send({
        criticalEventEmailsEnabled: false,
        enrollmentEmailsEnabled: false,
      })
      .expect(200);

    mailerService.clearDeliveries();

    await request(app.getHttpServer())
      .post(apiPath('/auth/password/forgot'))
      .send({ email: prefsUser.email })
      .expect(200);

    expect(
      findLatestDelivery(prefsUser.email, 'Reset your Noderax password'),
    ).toBeDefined();

    const workspaceAdmin = await createAcceptedUser(
      'workspace-admin@example.com',
      {
        name: 'Workspace Admin',
      },
    );
    const workspaceAdminToken = await login(
      workspaceAdmin.email,
      workspaceAdmin.password,
    );

    await request(app.getHttpServer())
      .post(apiPath(`/workspaces/${workspaceId}/members`))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        userId: workspaceAdmin.id,
        role: 'admin',
      })
      .expect(201);

    await request(app.getHttpServer())
      .patch(apiPath('/users/me/preferences'))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        criticalEventEmailsEnabled: false,
        enrollmentEmailsEnabled: false,
      })
      .expect(200);

    await request(app.getHttpServer())
      .patch(apiPath('/users/me/preferences'))
      .set('Authorization', `Bearer ${workspaceAdminToken}`)
      .send({
        criticalEventEmailsEnabled: false,
        enrollmentEmailsEnabled: false,
      })
      .expect(200);

    mailerService.clearDeliveries();

    await eventsService.record({
      workspaceId,
      type: 'workspace.critical',
      severity: EventSeverity.CRITICAL,
      message: 'Critical workspace alert',
    });

    expect(mailerService.getDeliveries()).toHaveLength(0);

    await request(app.getHttpServer())
      .patch(apiPath('/users/me/preferences'))
      .set('Authorization', `Bearer ${workspaceAdminToken}`)
      .send({
        criticalEventEmailsEnabled: true,
        enrollmentEmailsEnabled: true,
      })
      .expect(200);

    mailerService.clearDeliveries();

    await eventsService.record({
      workspaceId,
      type: 'workspace.critical.enabled',
      severity: EventSeverity.CRITICAL,
      message: 'Critical workspace alert after opt-in',
    });

    expect(mailerService.getDeliveries()).toEqual([
      expect.objectContaining({
        to: [workspaceAdmin.email],
      }),
    ]);

    mailerService.clearDeliveries();

    await request(app.getHttpServer())
      .post(apiPath('/enrollments/initiate'))
      .send({
        email: workspaceAdmin.email,
        hostname: 'enrollment-workspace-admin-01',
      })
      .expect(201);

    expect(mailerService.getDeliveries()).toEqual([
      expect.objectContaining({
        to: [workspaceAdmin.email],
      }),
    ]);

    await request(app.getHttpServer())
      .patch(apiPath('/users/me/preferences'))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        criticalEventEmailsEnabled: true,
        enrollmentEmailsEnabled: true,
      })
      .expect(200);
  });

  it('enforces archived workspace read-only rules and default workspace constraints', async () => {
    await request(app.getHttpServer())
      .patch(apiPath(`/workspaces/${workspaceId}`))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isArchived: true })
      .expect(409);

    const archivedWorkspace = await createWorkspace(
      'Archive Candidate',
      'archive-candidate',
    );
    const archiveUser = await createAcceptedUser('archive-user@example.com', {
      name: 'Archive User',
    });

    await request(app.getHttpServer())
      .post(apiPath(`/workspaces/${archivedWorkspace.id}/members`))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        userId: archiveUser.id,
        role: 'member',
      })
      .expect(201);

    const archiveNode = await createWorkspaceNode(
      archivedWorkspace.id,
      'Archive Node',
      'archive-node-01',
    );

    await request(app.getHttpServer())
      .patch(apiPath(`/workspaces/${archivedWorkspace.id}`))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isArchived: true })
      .expect(200)
      .expect(({ body }) => {
        expect(body.isArchived).toBe(true);
      });

    await request(app.getHttpServer())
      .get(apiPath(`/workspaces/${archivedWorkspace.id}`))
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .get(apiPath(`/workspaces/${archivedWorkspace.id}/members`))
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .get(apiPath(`/workspaces/${archivedWorkspace.id}/search?q=archive`))
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .patch(apiPath(`/workspaces/${archivedWorkspace.id}`))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Archived Workspace Updated' })
      .expect(409);

    await request(app.getHttpServer())
      .post(apiPath(`/workspaces/${archivedWorkspace.id}/members`))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        userId: adminUserId,
        role: 'viewer',
      })
      .expect(409);

    await request(app.getHttpServer())
      .post(apiPath(`/workspaces/${archivedWorkspace.id}/teams`))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Blocked Team',
      })
      .expect(409);

    await request(app.getHttpServer())
      .post(apiPath(`/workspaces/${archivedWorkspace.id}/nodes`))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Blocked Node',
        hostname: 'blocked-node-01',
        os: 'ubuntu',
        arch: 'amd64',
      })
      .expect(409);

    await request(app.getHttpServer())
      .post(apiPath(`/workspaces/${archivedWorkspace.id}/tasks`))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        nodeId: archiveNode.id,
        type: 'shell.exec',
        payload: {
          title: 'Blocked Task',
          command: 'hostname',
        },
      })
      .expect(409);

    await request(app.getHttpServer())
      .post(apiPath(`/workspaces/${archivedWorkspace.id}/scheduled-tasks`))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        nodeId: archiveNode.id,
        name: 'Blocked Schedule',
        command: 'hostname',
        cadence: 'hourly',
        minute: 5,
      })
      .expect(409);

    await request(app.getHttpServer())
      .patch(apiPath(`/workspaces/${archivedWorkspace.id}`))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isDefault: true })
      .expect(409);

    await request(app.getHttpServer())
      .patch(apiPath(`/workspaces/${archivedWorkspace.id}`))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isArchived: false })
      .expect(200)
      .expect(({ body }) => {
        expect(body.isArchived).toBe(false);
      });

    await request(app.getHttpServer())
      .post(apiPath(`/workspaces/${archivedWorkspace.id}/teams`))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Restored Team',
      })
      .expect(201);
  });

  it('searches only within the requested workspace across grouped resources', async () => {
    const searchWorkspace = await createWorkspace('Falcon Ops', 'falcon-ops');
    const otherWorkspace = await createWorkspace(
      'Falcon Shadow',
      'falcon-shadow',
    );
    const searchUser = await createAcceptedUser('falcon-user@example.com', {
      name: 'Falcon User',
    });

    await request(app.getHttpServer())
      .post(apiPath(`/workspaces/${searchWorkspace.id}/members`))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        userId: searchUser.id,
        role: 'member',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(apiPath(`/workspaces/${searchWorkspace.id}/teams`))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Falcon Team',
        description: 'Falcon operators',
      })
      .expect(201);

    const searchNode = await createWorkspaceNode(
      searchWorkspace.id,
      'Falcon Node',
      'falcon-node-01',
    );

    await request(app.getHttpServer())
      .post(apiPath(`/workspaces/${searchWorkspace.id}/tasks`))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        nodeId: searchNode.id,
        type: 'shell.exec',
        payload: {
          title: 'Falcon Audit',
          command: 'echo falcon',
        },
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(apiPath(`/workspaces/${searchWorkspace.id}/scheduled-tasks`))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        nodeId: searchNode.id,
        name: 'Falcon Nightly',
        command: 'echo falcon',
        cadence: 'hourly',
        minute: 15,
      })
      .expect(201);

    await eventsService.record({
      workspaceId: searchWorkspace.id,
      nodeId: searchNode.id,
      type: 'falcon.alert',
      severity: EventSeverity.INFO,
      message: 'Falcon signal detected',
    });

    await createWorkspaceNode(
      otherWorkspace.id,
      'Falcon Hidden Node',
      'falcon-hidden-01',
    );

    await request(app.getHttpServer())
      .get(apiPath(`/workspaces/${searchWorkspace.id}/search?q=falcon&limit=5`))
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.nodes).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              title: 'Falcon Node',
            }),
          ]),
        );
        expect(body.tasks).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              title: 'Falcon Audit',
            }),
          ]),
        );
        expect(body.scheduledTasks).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              title: 'Falcon Nightly',
            }),
          ]),
        );
        expect(body.events).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              title: 'falcon.alert',
            }),
          ]),
        );
        expect(body.members).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              title: 'Falcon User',
            }),
          ]),
        );
        expect(body.teams).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              title: 'Falcon Team',
            }),
          ]),
        );
        expect(
          body.nodes.some(
            (result: { title: string }) =>
              result.title === 'Falcon Hidden Node',
          ),
        ).toBe(false);
      });
  });
});
