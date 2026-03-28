import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { io, Socket } from 'socket.io-client';
import { TASK_TYPES } from '../src/common/constants/task-types.constants';
import { apiPath } from './helpers/api-path';
import { createE2eApp } from './helpers/e2e-app.factory';

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

type AgentTaskEnvelope = {
  id: string;
  type: string;
  status: string;
  payload: Record<string, unknown>;
};

function buildAgentHeaders(nodeId: string, agentToken: string) {
  return {
    Authorization: `Bearer ${agentToken}`,
    'x-agent-node-id': nodeId,
  };
}

async function waitForQueuedTask(
  app: INestApplication,
  nodeId: string,
  agentToken: string,
  taskType: string,
): Promise<AgentTaskEnvelope> {
  let matchedTask: AgentTaskEnvelope | null = null;

  await waitFor(
    async () => {
      const response = await request(app.getHttpServer())
        .post(apiPath('/agent/tasks/claim'))
        .set(buildAgentHeaders(nodeId, agentToken))
        .send({
          maxTasks: 1,
          waitMs: 0,
        })
        .expect((res) => {
          if (![200, 204].includes(res.status)) {
            throw new Error(`Unexpected claim status ${res.status}`);
          }
        });

      const claimedTask =
        response.status === 200
          ? (response.body.task as AgentTaskEnvelope | null)
          : null;
      matchedTask = claimedTask?.type === taskType ? claimedTask : null;

      return matchedTask !== null;
    },
    {
      timeoutMs: 5000,
      intervalMs: 100,
    },
  );

  if (!matchedTask) {
    throw new Error(`Task ${taskType} was not queued`);
  }

  return matchedTask;
}

async function startTaskAsAgent(
  app: INestApplication,
  taskId: string,
  nodeId: string,
  agentToken: string,
) {
  await request(app.getHttpServer())
    .post(apiPath(`/agent/tasks/${taskId}/started`))
    .set(buildAgentHeaders(nodeId, agentToken))
    .send({
      taskId,
      timestamp: new Date().toISOString(),
    })
    .expect(200);
}

async function completeTaskAsAgent(
  app: INestApplication,
  taskId: string,
  nodeId: string,
  agentToken: string,
  body: Record<string, unknown>,
) {
  await request(app.getHttpServer())
    .post(apiPath(`/agent/tasks/${taskId}/completed`))
    .set(buildAgentHeaders(nodeId, agentToken))
    .send({
      taskId,
      timestamp: new Date().toISOString(),
      durationMs: 25,
      ...body,
    })
    .expect(200);
}

describe('Agent Lifecycle (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let userToken: string;
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
  }, 30000);

  it('logs in as the seeded admin user', async () => {
    const response = await request(app.getHttpServer())
      .post(apiPath('/auth/login'))
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
    await request(app.getHttpServer()).get(apiPath('/users/me')).expect(401);

    await request(app.getHttpServer())
      .get(apiPath('/users/me'))
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.email).toBe(process.env.ADMIN_EMAIL);
        expect(body.role).toBe('platform_admin');
      });
  });

  it('creates and logs in a standard user for read-only package access', async () => {
    await request(app.getHttpServer())
      .post(apiPath('/users'))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: 'user@example.com',
        name: 'Read Only User',
        password: 'ChangeMe123!',
        role: 'user',
      })
      .expect(201);

    const response = await request(app.getHttpServer())
      .post(apiPath('/auth/login'))
      .send({
        email: 'user@example.com',
        password: 'ChangeMe123!',
      })
      .expect(200);

    expect(response.body.user.role).toBe('user');
    userToken = response.body.accessToken;
  });

  it('rejects agent registration with an invalid enrollment token', async () => {
    await request(app.getHttpServer())
      .post(apiPath('/agent/register'))
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
      .post(apiPath('/agent/register'))
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
      .post(apiPath('/agent/register'))
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

  it('accepts the Go agent registration payload shape', async () => {
    await request(app.getHttpServer())
      .post(apiPath('/agent/register'))
      .send({
        hostname: 'srv-go-agent-01',
        operatingSystem: 'ubuntu',
        platform: 'linux',
        platformVersion: '24.04',
        kernelVersion: '6.8.0',
        architecture: 'amd64',
        agentVersion: 'dev',
        enrollmentToken: process.env.AGENT_ENROLLMENT_TOKEN,
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body.nodeId).toBeDefined();
        expect(body.agentToken).toBeDefined();
      });
  });

  it('accepts heartbeats and ingests metrics for a valid agent', async () => {
    await request(app.getHttpServer())
      .post(apiPath('/agent/heartbeat'))
      .send({
        nodeId,
        agentToken,
        agentVersion: 'dev',
        sentAt: new Date().toISOString(),
      })
      .expect(200)
      .expect(({ body }) => {
        expect(body.acknowledged).toBe(true);
        expect(body.status).toBe('online');
      });

    await request(app.getHttpServer())
      .post(apiPath('/agent/metrics'))
      .send({
        nodeId,
        agentToken,
        collectedAt: new Date().toISOString(),
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
      .post(apiPath('/tasks'))
      .send({
        nodeId,
        type: 'shell.exec',
        payload: {
          command: 'hostname',
        },
      })
      .expect(401);

    const response = await request(app.getHttpServer())
      .post(apiPath('/tasks'))
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
      .post(apiPath('/agent/tasks/claim'))
      .set(buildAgentHeaders(nodeId, agentToken))
      .send({
        maxTasks: 1,
        waitMs: 0,
      })
      .expect(200)
      .expect(({ body }) => {
        expect(body.task.id).toBe(taskId);
        expect(body.task.status).toBe('accepted');
      });

    await request(app.getHttpServer())
      .post(apiPath(`/agent/tasks/${taskId}/started`))
      .set(buildAgentHeaders(secondNodeId, secondAgentToken))
      .send({
        taskId,
      })
      .expect(404);
  });

  it('executes the task lifecycle for the owning agent', async () => {
    await request(app.getHttpServer())
      .post(apiPath(`/agent/tasks/${taskId}/started`))
      .set(buildAgentHeaders(nodeId, agentToken))
      .send({
        taskId,
        timestamp: new Date().toISOString(),
      })
      .expect(200)
      .expect(({ body }) => {
        expect(body.status).toBe('running');
        expect(body.startedAt).toBeDefined();
      });

    await request(app.getHttpServer())
      .post(apiPath(`/agent/tasks/${taskId}/logs`))
      .set(buildAgentHeaders(nodeId, agentToken))
      .send({
        taskId,
        timestamp: new Date().toISOString(),
        stream: 'stdout',
        line: 'hostname resolved to srv-test-01',
      })
      .expect(200)
      .expect(({ body }) => {
        expect(body.taskId).toBe(taskId);
        expect(body.level).toBe('stdout');
      });

    await request(app.getHttpServer())
      .post(apiPath(`/agent/tasks/${taskId}/completed`))
      .set(buildAgentHeaders(nodeId, agentToken))
      .send({
        taskId,
        status: 'success',
        exitCode: 0,
        timestamp: new Date().toISOString(),
        durationMs: 25,
      })
      .expect(200)
      .expect(({ body }) => {
        expect(body.status).toBe('success');
        expect(body.result.exitCode).toBe(0);
        expect(body.result.durationMs).toBe(25);
        expect(body.finishedAt).toBeDefined();
      });

    await request(app.getHttpServer())
      .get(apiPath(`/tasks/${taskId}`))
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.status).toBe('success');
      });

    await request(app.getHttpServer())
      .get(apiPath(`/tasks/${taskId}/logs`))
      .set('Authorization', `Bearer ${adminToken}`)
      .query({ limit: 1000 })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toHaveLength(1);
        expect(body[0].message).toContain('hostname resolved');
      });
  });

  it('lets authenticated users list installed packages through package tasks', async () => {
    const responsePromise = fetch(
      `${getBaseUrl(app)}${apiPath(`/nodes/${nodeId}/packages`)}`,
      {
        headers: {
          Authorization: `Bearer ${userToken}`,
        },
      },
    );

    const packageTask = await waitForQueuedTask(
      app,
      nodeId,
      agentToken,
      TASK_TYPES.PACKAGE_LIST,
    );

    await startTaskAsAgent(app, packageTask.id, nodeId, agentToken);
    await completeTaskAsAgent(app, packageTask.id, nodeId, agentToken, {
      status: 'success',
      result: {
        packages: [
          {
            name: 'nginx',
            version: '1.24.0-2ubuntu7',
            architecture: 'amd64',
            description: 'small, powerful, scalable web/proxy server',
          },
        ],
      },
    });

    const response = await responsePromise;
    const body = (await response.json()) as {
      taskId: string;
      taskStatus: string;
      packages: Array<{ name: string; version: string | null }>;
      error: string | null;
    };

    expect(response.status).toBe(200);
    expect(body.taskId).toBe(packageTask.id);
    expect(body.taskStatus).toBe('success');
    expect(body.packages).toHaveLength(1);
    expect(body.packages[0]).toMatchObject({
      name: 'nginx',
      version: '1.24.0-2ubuntu7',
      architecture: 'amd64',
      description: 'small, powerful, scalable web/proxy server',
    });
    expect(body.error).toBeNull();
  });

  it('lets authenticated users search packages through package tasks', async () => {
    const responsePromise = fetch(
      `${getBaseUrl(app)}${apiPath(
        `/packages/search?nodeId=${nodeId}&term=nginx`,
      )}`,
      {
        headers: {
          Authorization: `Bearer ${userToken}`,
        },
      },
    );

    const packageTask = await waitForQueuedTask(
      app,
      nodeId,
      agentToken,
      TASK_TYPES.PACKAGE_SEARCH,
    );

    await startTaskAsAgent(app, packageTask.id, nodeId, agentToken);
    await completeTaskAsAgent(app, packageTask.id, nodeId, agentToken, {
      status: 'success',
      result: {
        results: [
          {
            name: 'nginx',
            version: '1.24.0-2ubuntu7',
            description: 'small, powerful, scalable web/proxy server',
          },
        ],
      },
    });

    const response = await responsePromise;
    const body = (await response.json()) as {
      taskId: string;
      taskStatus: string;
      term: string;
      results: Array<{ name: string; version: string | null }>;
      error: string | null;
    };

    expect(response.status).toBe(200);
    expect(body.taskId).toBe(packageTask.id);
    expect(body.taskStatus).toBe('success');
    expect(body.term).toBe('nginx');
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toMatchObject({
      name: 'nginx',
      version: '1.24.0-2ubuntu7',
      description: 'small, powerful, scalable web/proxy server',
    });
    expect(body.error).toBeNull();
  });

  it('returns 403 for non-admin package mutations', async () => {
    await request(app.getHttpServer())
      .post(apiPath(`/nodes/${nodeId}/packages`))
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        names: ['nginx'],
        purge: false,
      })
      .expect(403);

    await request(app.getHttpServer())
      .delete(apiPath(`/nodes/${nodeId}/packages/nginx`))
      .set('Authorization', `Bearer ${userToken}`)
      .query({
        purge: true,
      })
      .expect(403);
  });

  it('queues package installation for admins with the exact payload', async () => {
    const response = await request(app.getHttpServer())
      .post(apiPath(`/nodes/${nodeId}/packages`))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        names: ['nginx', 'curl'],
        purge: true,
      })
      .expect(202);

    expect(response.body.operation).toBe(TASK_TYPES.PACKAGE_INSTALL);
    expect(response.body.taskStatus).toBe('queued');

    const packageTask = await waitForQueuedTask(
      app,
      nodeId,
      agentToken,
      TASK_TYPES.PACKAGE_INSTALL,
    );

    expect(packageTask.id).toBe(response.body.taskId);
    expect(packageTask.payload).toEqual({
      names: ['nginx', 'curl'],
      packages: ['nginx', 'curl'],
      purge: true,
    });
  });

  it('maps package deletion to remove and purge task types for admins', async () => {
    const removeResponse = await request(app.getHttpServer())
      .delete(apiPath(`/nodes/${nodeId}/packages/nginx`))
      .set('Authorization', `Bearer ${adminToken}`)
      .query({
        purge: false,
      })
      .expect(202);

    const removeTask = await request(app.getHttpServer())
      .get(apiPath(`/tasks/${removeResponse.body.taskId}`))
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(removeResponse.body.operation).toBe(TASK_TYPES.PACKAGE_REMOVE);
    expect(removeTask.body.type).toBe(TASK_TYPES.PACKAGE_REMOVE);
    expect(removeTask.body.payload).toEqual({
      names: ['nginx'],
      packages: ['nginx'],
      package: 'nginx',
      purge: false,
    });

    const purgeResponse = await request(app.getHttpServer())
      .delete(apiPath(`/nodes/${nodeId}/packages/nginx`))
      .set('Authorization', `Bearer ${adminToken}`)
      .query({
        purge: true,
      })
      .expect(202);

    const purgeTask = await request(app.getHttpServer())
      .get(apiPath(`/tasks/${purgeResponse.body.taskId}`))
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(purgeResponse.body.operation).toBe(TASK_TYPES.PACKAGE_PURGE);
    expect(purgeTask.body.type).toBe(TASK_TYPES.PACKAGE_REMOVE);
    expect(purgeTask.body.payload).toEqual({
      names: ['nginx'],
      packages: ['nginx'],
      package: 'nginx',
      purge: true,
    });
  }, 15000);

  it('returns 202 with a task id when package search does not finish within the wait window', async () => {
    const responsePromise = fetch(
      `${getBaseUrl(app)}${apiPath(
        `/packages/search?nodeId=${nodeId}&term=redis`,
      )}`,
      {
        headers: {
          Authorization: `Bearer ${userToken}`,
        },
      },
    );

    const response = await responsePromise;
    const body = (await response.json()) as {
      taskId: string;
      taskStatus: string;
      operation: string;
      term: string;
    };

    expect(response.status).toBe(202);
    expect(body.taskId).toBeDefined();
    expect(body.operation).toBe(TASK_TYPES.PACKAGE_SEARCH);
    expect(body.taskStatus).toBe('queued');
    expect(body.term).toBe('redis');

    await request(app.getHttpServer())
      .get(apiPath(`/tasks/${body.taskId}`))
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect(({ body: taskBody }) => {
        expect(taskBody.type).toBe(TASK_TYPES.PACKAGE_SEARCH);
        expect(taskBody.status).toBe('queued');
      });
  }, 15000);

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
          .get(apiPath(`/nodes/${nodeId}`))
          .set('Authorization', `Bearer ${adminToken}`);

        return response.body.status === 'offline';
      },
      { timeoutMs: 5000, intervalMs: 250 },
    );

    await request(app.getHttpServer())
      .post(apiPath('/agent/heartbeat'))
      .send({
        nodeId,
        agentToken,
      })
      .expect(200)
      .expect(({ body }) => {
        expect(body.status).toBe('online');
      });

    await request(app.getHttpServer())
      .get(apiPath(`/nodes/${nodeId}`))
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.status).toBe('online');
      });
  }, 15000);
});
