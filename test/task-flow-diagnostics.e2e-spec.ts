import { INestApplication } from '@nestjs/common';
import request from 'supertest';
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

describe('Task Flow Diagnostics (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let userToken: string;

  beforeAll(async () => {
    configureTestEnv();
    app = await createE2eApp();

    const adminLogin = await request(app.getHttpServer())
      .post(apiPath('/auth/login'))
      .send({
        email: process.env.ADMIN_EMAIL,
        password: process.env.ADMIN_PASSWORD,
      })
      .expect(200);

    adminToken = adminLogin.body.accessToken;

    await request(app.getHttpServer())
      .post(apiPath('/users'))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: 'diag-user@example.com',
        name: 'Diagnostics User',
        password: 'ChangeMe123!',
        role: 'user',
      })
      .expect(201);

    const userLogin = await request(app.getHttpServer())
      .post(apiPath('/auth/login'))
      .send({
        email: 'diag-user@example.com',
        password: 'ChangeMe123!',
      })
      .expect(200);

    userToken = userLogin.body.accessToken;
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('returns 401 when auth is missing', async () => {
    await request(app.getHttpServer())
      .get(apiPath('/diagnostics/task-flow'))
      .expect(401);
  });

  it('returns 403 for non-admin users', async () => {
    await request(app.getHttpServer())
      .get(apiPath('/diagnostics/task-flow'))
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);
  });

  it('returns 200 with stable schema and no-store header for admin', async () => {
    const response = await request(app.getHttpServer())
      .get(apiPath('/diagnostics/task-flow'))
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.headers['cache-control']).toContain('no-store');

    expect(typeof response.body.fetchedAt).toBe('string');
    expect(new Date(response.body.fetchedAt).toISOString()).toBe(
      response.body.fetchedAt,
    );
    expect(response.body.source).toBe('agent-task-flow');

    expect(response.body.agentCounters).toEqual(
      expect.objectContaining({
        'metrics.ingested': expect.any(Number),
        'connection.opened': expect.any(Number),
      }),
    );

    expect(response.body.claimCounters).toEqual(
      expect.objectContaining({
        'task.claim.attempted': expect.any(Number),
        'task.claim.succeeded': expect.any(Number),
        'task.claim.failed': expect.any(Number),
        'task.claim.emptyPoll': expect.any(Number),
      }),
    );

    expect(response.body.queue).toEqual(
      expect.objectContaining({
        queued: expect.any(Number),
        running: expect.any(Number),
      }),
    );

    expect(response.body.health).toEqual(
      expect.objectContaining({
        realtimeConnected: expect.any(Boolean),
      }),
    );

    if (response.body.health.lastAgentSeenAt !== null) {
      expect(new Date(response.body.health.lastAgentSeenAt).toISOString()).toBe(
        response.body.health.lastAgentSeenAt,
      );
    }
    if (response.body.health.lastClaimAt !== null) {
      expect(new Date(response.body.health.lastClaimAt).toISOString()).toBe(
        response.body.health.lastClaimAt,
      );
    }
  });

  it('returns default zero/null counters when sources are empty', async () => {
    const response = await request(app.getHttpServer())
      .get(apiPath('/diagnostics/task-flow'))
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.agentCounters['metrics.ingested']).toBe(0);
    expect(response.body.agentCounters['connection.opened']).toBe(0);

    expect(response.body.claimCounters['task.claim.attempted']).toBe(0);
    expect(response.body.claimCounters['task.claim.succeeded']).toBe(0);
    expect(response.body.claimCounters['task.claim.failed']).toBe(0);
    expect(response.body.claimCounters['task.claim.emptyPoll']).toBe(0);

    expect(response.body.queue.queued).toBe(0);
    expect(response.body.queue.running).toBe(0);

    expect(response.body.health.realtimeConnected).toBe(false);
    expect(response.body.health.lastAgentSeenAt).toBeNull();
    expect(response.body.health.lastClaimAt).toBeNull();
  });

  it('keeps claimCounters and agentCounters values as numbers', async () => {
    const response = await request(app.getHttpServer())
      .get(apiPath('/diagnostics/task-flow'))
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    for (const value of Object.values(response.body.agentCounters)) {
      expect(typeof value).toBe('number');
    }

    for (const value of Object.values(response.body.claimCounters)) {
      expect(typeof value).toBe('number');
    }
  });

  it('serves diagnostics with smoke benchmark timing', async () => {
    const samples: number[] = [];

    for (let i = 0; i < 12; i += 1) {
      const started = Date.now();
      await request(app.getHttpServer())
        .get(apiPath('/diagnostics/task-flow'))
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      samples.push(Date.now() - started);
    }

    samples.sort((a, b) => a - b);
    const p95Index = Math.max(Math.floor(samples.length * 0.95) - 1, 0);
    const p95 = samples[p95Index] ?? samples[samples.length - 1] ?? 0;

    // Smoke guardrail for CI stability; production target remains lower.
    expect(p95).toBeLessThan(500);
  });
});
