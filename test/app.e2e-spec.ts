import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { apiPath } from './helpers/api-path';
import { createE2eApp } from './helpers/e2e-app.factory';

describe('App (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
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

    app = await createE2eApp();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('/health (GET)', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect(({ body }) => {
        expect(body.service).toBe('noderax-api');
        expect(body.status).toBe('ok');
      });
  });

  it('/api/v1/health (GET)', () => {
    return request(app.getHttpServer())
      .get(apiPath('/health'))
      .expect(200)
      .expect(({ body }) => {
        expect(body.service).toBe('noderax-api');
        expect(body.status).toBe('ok');
      });
  });

  it('normalizes validation errors to a string message', () => {
    return request(app.getHttpServer())
      .post(apiPath('/agent/register'))
      .send({})
      .expect(400)
      .expect(({ body }) => {
        expect(typeof body.message).toBe('string');
        expect(body.message.length).toBeGreaterThan(0);
        expect(body.errors).toEqual(expect.any(Array));
        expect(body.errors.length).toBeGreaterThan(0);
      });
  });
});
