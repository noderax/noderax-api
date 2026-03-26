import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as request from 'supertest';
import { ScheduledTaskEntity } from '../src/modules/tasks/entities/scheduled-task.entity';
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

describe('Scheduled Tasks (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let adminToken: string;
  let userToken: string;
  let adminUserId: string;
  let workspaceId: string;
  let nodeId: string;
  let secondaryNodeId: string;

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

    await request(app.getHttpServer())
      .post(apiPath('/users'))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: 'user@example.com',
        name: 'Standard User',
        password: 'ChangeMe123!',
        role: 'user',
      })
      .expect(201);

    const userLogin = await request(app.getHttpServer())
      .post(apiPath('/auth/login'))
      .send({
        email: 'user@example.com',
        password: 'ChangeMe123!',
      })
      .expect(200);

    userToken = userLogin.body.accessToken;

    const nodeResponse = await request(app.getHttpServer())
      .post(apiPath('/nodes'))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Schedule Node',
        hostname: 'schedule-node-01',
        os: 'ubuntu',
        arch: 'amd64',
      })
      .expect(201);

    nodeId = nodeResponse.body.id;

    const secondaryNodeResponse = await request(app.getHttpServer())
      .post(apiPath('/nodes'))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Schedule Node 02',
        hostname: 'schedule-node-02',
        os: 'ubuntu',
        arch: 'arm64',
      })
      .expect(201);

    secondaryNodeId = secondaryNodeResponse.body.id;
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('allows only admins to manage scheduled tasks', async () => {
    await request(app.getHttpServer())
      .get(apiPath('/scheduled-tasks'))
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .post(apiPath('/scheduled-tasks'))
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        nodeId,
        name: 'Forbidden schedule',
        command: 'hostname',
        cadence: 'hourly',
        minute: 5,
      })
      .expect(403);

    await request(app.getHttpServer())
      .post(apiPath('/tasks/batch'))
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        nodeIds: [nodeId, secondaryNodeId],
        type: 'shell.exec',
        payload: {
          command: 'hostname',
        },
      })
      .expect(403);

    await request(app.getHttpServer())
      .post(apiPath('/scheduled-tasks/batch'))
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        nodeIds: [nodeId, secondaryNodeId],
        name: 'Forbidden batch schedule',
        command: 'hostname',
        cadence: 'custom',
        minute: 0,
        intervalMinutes: 7,
      })
      .expect(403);
  });

  it('creates, lists, disables, and deletes scheduled tasks', async () => {
    const createResponse = await request(app.getHttpServer())
      .post(apiPath('/scheduled-tasks'))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        nodeId,
        name: 'Daily hostname check',
        command: 'hostname',
        cadence: 'daily',
        minute: 15,
        hour: 3,
      })
      .expect(201);

    expect(createResponse.body.name).toBe('Daily hostname check');
    expect(createResponse.body.enabled).toBe(true);
    expect(createResponse.body.ownerUserId).toBe(adminUserId);
    expect(createResponse.body.ownerName).toBe(process.env.ADMIN_NAME);
    expect(createResponse.body.timezone).toBe('UTC');

    await request(app.getHttpServer())
      .get(apiPath('/scheduled-tasks'))
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: createResponse.body.id,
              name: 'Daily hostname check',
            }),
          ]),
        );
      });

    await request(app.getHttpServer())
      .patch(apiPath(`/scheduled-tasks/${createResponse.body.id}`))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ enabled: false })
      .expect(200)
      .expect(({ body }) => {
        expect(body.enabled).toBe(false);
        expect(body.nextRunAt).toBeNull();
      });

    await request(app.getHttpServer())
      .delete(apiPath(`/scheduled-tasks/${createResponse.body.id}`))
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({
          deleted: true,
          id: createResponse.body.id,
        });
      });
  });

  it('creates custom interval schedules', async () => {
    const createResponse = await request(app.getHttpServer())
      .post(apiPath('/scheduled-tasks'))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        nodeId,
        name: 'Every 7 minutes',
        command: 'hostname',
        cadence: 'custom',
        minute: 0,
        intervalMinutes: 7,
      })
      .expect(201);

    expect(createResponse.body.cadence).toBe('custom');
    expect(createResponse.body.intervalMinutes).toBe(7);
    expect(createResponse.body.hour).toBeNull();
    expect(createResponse.body.dayOfWeek).toBeNull();
  });

  it('creates one-off tasks and schedules for multiple nodes', async () => {
    const batchTasksResponse = await request(app.getHttpServer())
      .post(apiPath('/tasks/batch'))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        nodeIds: [nodeId, secondaryNodeId],
        type: 'shell.exec',
        payload: {
          command: 'hostname',
        },
      })
      .expect(201);

    expect(batchTasksResponse.body).toHaveLength(2);
    expect(
      new Set(
        batchTasksResponse.body.map((task: { nodeId: string }) => task.nodeId),
      ),
    ).toEqual(new Set([nodeId, secondaryNodeId]));
    expect(
      batchTasksResponse.body.every(
        (task: { type: string; payload: { command?: string } }) =>
          task.type === 'shell.exec' && task.payload.command === 'hostname',
      ),
    ).toBe(true);

    const batchSchedulesResponse = await request(app.getHttpServer())
      .post(apiPath('/scheduled-tasks/batch'))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        nodeIds: [nodeId, secondaryNodeId],
        name: 'Every 7 minutes on both nodes',
        command: 'hostname',
        cadence: 'custom',
        minute: 0,
        intervalMinutes: 7,
      })
      .expect(201);

    expect(batchSchedulesResponse.body).toHaveLength(2);
    expect(
      new Set(
        batchSchedulesResponse.body.map(
          (schedule: { nodeId: string }) => schedule.nodeId,
        ),
      ),
    ).toEqual(new Set([nodeId, secondaryNodeId]));
    expect(
      batchSchedulesResponse.body.every(
        (schedule: {
          cadence: string;
          intervalMinutes: number;
          ownerUserId: string;
        }) =>
          schedule.cadence === 'custom' &&
          schedule.intervalMinutes === 7 &&
          schedule.ownerUserId === adminUserId,
      ),
    ).toBe(true);
  });

  it('queues a real task when a due schedule is detected and skips disabled schedules', async () => {
    const createResponse = await request(app.getHttpServer())
      .post(apiPath('/scheduled-tasks'))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        nodeId,
        name: 'Hourly hostname check',
        command: 'hostname',
        cadence: 'hourly',
        minute: 10,
      })
      .expect(201);

    const scheduledTaskRepo = dataSource.getRepository(ScheduledTaskEntity);
    await scheduledTaskRepo.update(
      { id: createResponse.body.id },
      {
        nextRunAt: new Date(Date.now() - 2_000),
      },
    );

    const queuedTask = await waitForTaskFromSchedule(
      app,
      adminToken,
      createResponse.body.id,
    );

    expect(queuedTask.type).toBe('shell.exec');
    expect(queuedTask.payload.scheduleId).toBe(createResponse.body.id);
    expect(queuedTask.payload.scheduleName).toBe('Hourly hostname check');

    await request(app.getHttpServer())
      .patch(apiPath(`/scheduled-tasks/${createResponse.body.id}`))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ enabled: false })
      .expect(200);

    await scheduledTaskRepo.update(
      { id: createResponse.body.id },
      {
        nextRunAt: new Date(Date.now() - 2_000),
      },
    );

    await new Promise((resolve) => setTimeout(resolve, 1_500));

    const tasksResponse = await request(app.getHttpServer())
      .get(apiPath('/tasks'))
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const matchingTasks = tasksResponse.body.filter(
      (task: { payload: { scheduleId?: string } }) =>
        task.payload?.scheduleId === createResponse.body.id,
    );

    expect(matchingTasks).toHaveLength(1);
  });

  it('keeps user timezone as display-only and recomputes workspace schedules when the workspace timezone changes', async () => {
    await request(app.getHttpServer())
      .patch(apiPath('/users/me/preferences'))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ timezone: 'Europe/Istanbul' })
      .expect(200)
      .expect(({ body }) => {
        expect(body.timezone).toBe('Europe/Istanbul');
      });

    const createResponse = await request(app.getHttpServer())
      .post(apiPath('/scheduled-tasks'))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        nodeId,
        name: 'Owner timezone schedule',
        command: 'hostname',
        cadence: 'daily',
        minute: 0,
        hour: 9,
      })
      .expect(201);

    expect(createResponse.body.timezone).toBe('UTC');
    expect(createResponse.body.ownerUserId).toBe(adminUserId);

    const previousNextRunAt = createResponse.body.nextRunAt;

    await request(app.getHttpServer())
      .patch(apiPath('/users/me/preferences'))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ timezone: 'America/New_York' })
      .expect(200)
      .expect(({ body }) => {
        expect(body.timezone).toBe('America/New_York');
      });

    const meResponse = await request(app.getHttpServer())
      .get(apiPath('/users/me'))
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.timezone).toBe('America/New_York');
      });

    expect(meResponse.body.timezone).toBe('America/New_York');

    await request(app.getHttpServer())
      .patch(apiPath(`/workspaces/${workspaceId}`))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ defaultTimezone: 'Asia/Tokyo' })
      .expect(200)
      .expect(({ body }) => {
        expect(body.defaultTimezone).toBe('Asia/Tokyo');
      });

    await request(app.getHttpServer())
      .get(apiPath('/scheduled-tasks'))
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect(({ body }) => {
        const updatedSchedule = body.find(
          (schedule: { id: string }) => schedule.id === createResponse.body.id,
        );

        expect(updatedSchedule).toEqual(
          expect.objectContaining({
            ownerUserId: adminUserId,
            ownerName: process.env.ADMIN_NAME,
            timezone: 'Asia/Tokyo',
            timezoneSource: 'workspace',
          }),
        );
        expect(updatedSchedule.nextRunAt).not.toBe(previousNextRunAt);
      });

    const legacyScheduleRepo = dataSource.getRepository(ScheduledTaskEntity);
    await legacyScheduleRepo.update(
      { id: createResponse.body.id },
      {
        ownerUserId: null,
        timezone: 'UTC',
        timezoneSource: 'legacy_fixed',
      },
    );

    await request(app.getHttpServer())
      .get(apiPath('/scheduled-tasks'))
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect(({ body }) => {
        const legacySchedule = body.find(
          (schedule: { id: string }) => schedule.id === createResponse.body.id,
        );

        expect(legacySchedule).toEqual(
          expect.objectContaining({
            ownerUserId: null,
            timezone: 'UTC',
            timezoneSource: 'legacy_fixed',
            isLegacy: true,
          }),
        );
      });
  });
});

async function waitForTaskFromSchedule(
  app: INestApplication,
  adminToken: string,
  scheduleId: string,
): Promise<{
  id: string;
  type: string;
  payload: Record<string, unknown>;
}> {
  const deadline = Date.now() + 5_000;

  while (Date.now() < deadline) {
    const response = await request(app.getHttpServer())
      .get(apiPath('/tasks'))
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const matched = response.body.find(
      (task: { payload: { scheduleId?: string } }) =>
        task.payload?.scheduleId === scheduleId,
    );

    if (matched) {
      return matched;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Task was not queued for schedule ${scheduleId}`);
}
