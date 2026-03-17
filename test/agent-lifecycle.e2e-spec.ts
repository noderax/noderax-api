import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { io, Socket } from 'socket.io-client';
import { createE2eApp } from './helpers/e2e-app.factory';

function configureTestEnv() {
  process.env.NODE_ENV = 'test';
  process.env.PORT = '0';
  process.env.API_PREFIX = '';
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

function getBaseUrl(app: INestApplication): string {
  const address = app.getHttpServer().address();

  if (!address || typeof address === 'string') {
    throw new Error('Unable to resolve test server address');
  }

  return `http://127.0.0.1:${address.port}`;
}

async function waitFor(
  predicate: () => Promise<boolean>,
  options?: {
    timeoutMs?: number;
    intervalMs?: number;
  },
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? 5000;
  const intervalMs = options?.intervalMs ?? 200;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Condition was not met within ${timeoutMs}ms`);
}

function waitForConnect(client: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    client.once('connect', () => resolve());
    client.once('connect_error', (error) => reject(error));
  });
}

function waitForConnectError(client: Socket): Promise<Error> {
  return new Promise((resolve) => {
    client.once('connect_error', (error) => resolve(error));
  });
}

describe('Agent Lifecycle (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let nodeId: string;
  let agentToken: string;
  let secondNodeId: string;
  let secondAgentToken: string;
  let taskId: string;

  beforeAll(async () => {
    configureTestEnv();
    app = await createE2eApp();
  }, 30000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('logs in as the seeded admin user', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: process.env.ADMIN_EMAIL,
        password: process.env.ADMIN_PASSWORD,
      })
      .expect(200);

    expect(response.body.accessToken).toBeDefined();
    expect(response.body.user.email).toBe(process.env.ADMIN_EMAIL);
    adminToken = response.body.accessToken;
  });

  it('protects authenticated routes', async () => {
    await request(app.getHttpServer()).get('/users/me').expect(401);

    await request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.email).toBe(process.env.ADMIN_EMAIL);
        expect(body.role).toBe('admin');
      });
  });

  it('rejects agent registration with an invalid enrollment token', async () => {
    await request(app.getHttpServer())
      .post('/agent/register')
      .send({
        hostname: 'srv-test-01',
        os: 'linux',
        arch: 'amd64',
        enrollmentToken: 'invalid-token',
      })
      .expect(403);
  });

  it('registers agents with the valid enrollment token', async () => {
    const firstResponse = await request(app.getHttpServer())
      .post('/agent/register')
      .send({
        hostname: 'srv-test-01',
        os: 'linux',
        arch: 'amd64',
        enrollmentToken: process.env.AGENT_ENROLLMENT_TOKEN,
      })
      .expect(201);

    nodeId = firstResponse.body.nodeId;
    agentToken = firstResponse.body.agentToken;

    const secondResponse = await request(app.getHttpServer())
      .post('/agent/register')
      .send({
        hostname: 'srv-test-02',
        os: 'linux',
        arch: 'arm64',
        enrollmentToken: process.env.AGENT_ENROLLMENT_TOKEN,
      })
      .expect(201);

    secondNodeId = secondResponse.body.nodeId;
    secondAgentToken = secondResponse.body.agentToken;

    expect(nodeId).toBeDefined();
    expect(agentToken).toBeDefined();
    expect(secondNodeId).toBeDefined();
    expect(secondAgentToken).toBeDefined();
  });

  it('accepts heartbeats and ingests metrics for a valid agent', async () => {
    await request(app.getHttpServer())
      .post('/agent/heartbeat')
      .send({
        nodeId,
        agentToken,
      })
      .expect(200)
      .expect(({ body }) => {
        expect(body.acknowledged).toBe(true);
        expect(body.status).toBe('online');
      });

    await request(app.getHttpServer())
      .post('/agent/metrics')
      .send({
        nodeId,
        agentToken,
        cpuUsage: 12.5,
        memoryUsage: 33.3,
        diskUsage: 44.4,
        networkStats: {
          rxBytes: 1000,
          txBytes: 2000,
        },
      })
      .expect(200)
      .expect(({ body }) => {
        expect(body.nodeId).toBe(nodeId);
        expect(body.cpuUsage).toBe(12.5);
      });
  });

  it('allows only admins to create tasks and lets agents fetch their own queued tasks', async () => {
    await request(app.getHttpServer())
      .post('/tasks')
      .send({
        nodeId,
        type: 'shell.exec',
        payload: {
          command: 'hostname',
        },
      })
      .expect(401);

    const response = await request(app.getHttpServer())
      .post('/tasks')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        nodeId,
        type: 'shell.exec',
        payload: {
          command: 'hostname',
        },
      })
      .expect(201);

    taskId = response.body.id;

    await request(app.getHttpServer())
      .post('/agent/tasks/pull')
      .send({
        nodeId,
        agentToken,
        limit: 1000,
      })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toHaveLength(1);
        expect(body[0].id).toBe(taskId);
        expect(body[0].status).toBe('queued');
      });

    await request(app.getHttpServer())
      .post(`/agent/tasks/${taskId}/start`)
      .send({
        nodeId: secondNodeId,
        agentToken: secondAgentToken,
      })
      .expect(404);
  });

  it('executes the task lifecycle for the owning agent', async () => {
    await request(app.getHttpServer())
      .post(`/agent/tasks/${taskId}/start`)
      .send({
        nodeId,
        agentToken,
      })
      .expect(200)
      .expect(({ body }) => {
        expect(body.status).toBe('running');
        expect(body.startedAt).toBeDefined();
      });

    await request(app.getHttpServer())
      .post(`/agent/tasks/${taskId}/logs`)
      .send({
        nodeId,
        agentToken,
        level: 'stdout',
        message: 'hostname resolved to srv-test-01',
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body.taskId).toBe(taskId);
        expect(body.level).toBe('stdout');
      });

    await request(app.getHttpServer())
      .post(`/agent/tasks/${taskId}/complete`)
      .send({
        nodeId,
        agentToken,
        status: 'success',
        result: {
          exitCode: 0,
        },
        output: 'hostname resolved to srv-test-01',
      })
      .expect(200)
      .expect(({ body }) => {
        expect(body.status).toBe('success');
        expect(body.result.exitCode).toBe(0);
        expect(body.output).toBe('hostname resolved to srv-test-01');
        expect(body.finishedAt).toBeDefined();
      });

    await request(app.getHttpServer())
      .get(`/tasks/${taskId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.status).toBe('success');
      });

    await request(app.getHttpServer())
      .get(`/tasks/${taskId}/logs`)
      .set('Authorization', `Bearer ${adminToken}`)
      .query({ limit: 1000 })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toHaveLength(2);
        expect(body[0].message).toContain('hostname resolved');
        expect(body[1].message).toContain('hostname resolved');
      });
  });

  it('rejects websocket connections with invalid JWTs', async () => {
    const client = io(`${getBaseUrl(app)}/realtime`, {
      auth: {
        token: 'invalid-token',
      },
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
    });

    const error = await waitForConnectError(client);
    expect(error.message).toContain('Invalid');
    client.close();
  });

  it('allows websocket connections with valid JWTs and authorized subscriptions', async () => {
    const client = io(`${getBaseUrl(app)}/realtime`, {
      auth: {
        token: adminToken,
      },
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
    });

    await waitForConnect(client);

    const subscriptionAck = await new Promise<{
      subscribed: boolean;
      nodeId: string;
    }>((resolve, reject) => {
      client
        .timeout(1000)
        .emit(
          'subscribe.node',
          { nodeId },
          (
            error: Error | null,
            response: { subscribed: boolean; nodeId: string },
          ) => {
            if (error) {
              reject(error);
              return;
            }

            resolve(response);
          },
        );
    });

    expect(subscriptionAck).toEqual({
      subscribed: true,
      nodeId,
    });

    client.close();
  });

  it('marks nodes offline in the background and recovers them on heartbeat', async () => {
    await waitFor(
      async () => {
        const response = await request(app.getHttpServer())
          .get(`/nodes/${nodeId}`)
          .set('Authorization', `Bearer ${adminToken}`);

        return response.body.status === 'offline';
      },
      { timeoutMs: 5000, intervalMs: 250 },
    );

    await request(app.getHttpServer())
      .post('/agent/heartbeat')
      .send({
        nodeId,
        agentToken,
      })
      .expect(200)
      .expect(({ body }) => {
        expect(body.status).toBe('online');
      });

    await request(app.getHttpServer())
      .get(`/nodes/${nodeId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.status).toBe('online');
      });
  }, 15000);
});
