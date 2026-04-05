import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as request from 'supertest';
import { EnrollmentEntity } from '../src/modules/enrollments/entities/enrollment.entity';
import { EnrollmentTokensService } from '../src/modules/enrollments/enrollment-tokens.service';
import { NodeInstallEntity } from '../src/modules/enrollments/entities/node-install.entity';
import { NodeEntity } from '../src/modules/nodes/entities/node.entity';
import { MailerService } from '../src/modules/notifications/mailer.service';
import { apiPath } from './helpers/api-path';
import { createE2eApp } from './helpers/e2e-app.factory';
import { createAcceptedUser, loginUser } from './helpers/user-lifecycle';

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
  process.env.AGENT_PUBLIC_API_URL = 'https://api.example.com';
  process.env.AGENT_INSTALL_SCRIPT_URL =
    'https://cdn.example.com/noderax-agent/install.sh';

  process.env.SEED_DEFAULT_ADMIN = 'true';
  process.env.ADMIN_NAME = 'E2E Admin';
  process.env.ADMIN_EMAIL = 'admin@example.com';
  process.env.ADMIN_PASSWORD = 'ChangeMe123!';
}

const extractBootstrapToken = (installCommand: string): string => {
  const match = installCommand.match(/--bootstrap-token '([^']+)'/);

  if (!match) {
    throw new Error(
      `Unable to extract bootstrap token from command: ${installCommand}`,
    );
  }

  return match[1];
};

describe('Enrollments (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let userToken: string;
  let dataSource: DataSource;
  let enrollmentTokensService: EnrollmentTokensService;
  let mailerService: MailerService;

  beforeAll(async () => {
    configureTestEnv();
    app = await createE2eApp();
    dataSource = app.get(DataSource);
    enrollmentTokensService = app.get(EnrollmentTokensService);
    mailerService = app.get(MailerService);

    const adminLogin = await request(app.getHttpServer())
      .post(apiPath('/auth/login'))
      .send({
        email: process.env.ADMIN_EMAIL,
        password: process.env.ADMIN_PASSWORD,
      })
      .expect(200);

    adminToken = adminLogin.body.accessToken;

    const user = await createAcceptedUser(app, mailerService, {
      adminToken,
      email: 'user@example.com',
      name: 'Standard User',
    });

    userToken = await loginUser(app, user.email, user.password);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('issues enrollment tokens without creating a node immediately', async () => {
    const response = await request(app.getHttpServer())
      .post(apiPath('/enrollments/initiate'))
      .send({
        email: 'admin@example.com',
        hostname: 'srv-enroll-01',
        additionalInfo: {
          os: 'ubuntu',
          arch: 'amd64',
          agentVersion: 'dev',
        },
      })
      .expect(201);

    expect(response.body.token).toEqual(expect.any(String));
    expect(new Date(response.body.expiresAt).toISOString()).toBe(
      response.body.expiresAt,
    );

    await request(app.getHttpServer())
      .get(apiPath('/nodes'))
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toHaveLength(0);
      });
  });

  it('returns pending enrollment status before approval', async () => {
    const initiate = await request(app.getHttpServer())
      .post(apiPath('/enrollments/initiate'))
      .send({
        email: 'admin@example.com',
        hostname: 'srv-enroll-02',
      })
      .expect(201);

    await request(app.getHttpServer())
      .get(apiPath(`/enrollments/${initiate.body.token}`))
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({
          status: 'pending',
        });
      });
  });

  it('allows only admins to finalize enrollments', async () => {
    const initiate = await request(app.getHttpServer())
      .post(apiPath('/enrollments/initiate'))
      .send({
        email: 'admin@example.com',
        hostname: 'srv-enroll-03',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(apiPath(`/enrollments/${initiate.body.token}/finalize`))
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        email: 'admin@example.com',
        nodeName: 'Enrollment Node 03',
      })
      .expect(403);
  });

  it('creates a node, stores hashed credentials, and exposes approved status polling', async () => {
    const initiate = await request(app.getHttpServer())
      .post(apiPath('/enrollments/initiate'))
      .send({
        email: 'admin@example.com',
        hostname: 'srv-enroll-04',
        additionalInfo: {
          operatingSystem: 'ubuntu',
          architecture: 'arm64',
        },
      })
      .expect(201);

    const finalize = await request(app.getHttpServer())
      .post(apiPath(`/enrollments/${initiate.body.token}/finalize`))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: 'admin@example.com',
        nodeName: 'Enrollment Node 04',
        description: 'Primary web node',
      })
      .expect(201);

    expect(finalize.body.nodeId).toEqual(expect.any(String));
    expect(finalize.body.agentToken).toEqual(expect.any(String));

    await request(app.getHttpServer())
      .get(apiPath(`/nodes/${finalize.body.nodeId}`))
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.name).toBe('Enrollment Node 04');
        expect(body.description).toBe('Primary web node');
        expect(body.hostname).toBe('srv-enroll-04');
        expect(body.os).toBe('ubuntu');
        expect(body.arch).toBe('arm64');
        expect(body.status).toBe('offline');
      });

    const nodeWithSecret = await dataSource
      .getRepository(NodeEntity)
      .createQueryBuilder('node')
      .addSelect('node.agentTokenHash')
      .where('node.id = :nodeId', {
        nodeId: finalize.body.nodeId,
      })
      .getOneOrFail();

    expect(nodeWithSecret.agentTokenHash).toEqual(expect.any(String));
    expect(nodeWithSecret.agentTokenHash).not.toBe(finalize.body.agentToken);

    await request(app.getHttpServer())
      .get(apiPath(`/enrollments/${initiate.body.token}`))
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({
          status: 'approved',
          nodeId: finalize.body.nodeId,
          agentToken: finalize.body.agentToken,
        });
      });
  });

  it('returns 404 for email mismatches and invalid tokens', async () => {
    const initiate = await request(app.getHttpServer())
      .post(apiPath('/enrollments/initiate'))
      .send({
        email: 'admin@example.com',
        hostname: 'srv-enroll-05',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(apiPath(`/enrollments/${initiate.body.token}/finalize`))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: 'other@example.com',
        nodeName: 'Enrollment Node 05',
      })
      .expect(404);

    await request(app.getHttpServer())
      .get(apiPath('/enrollments/not-a-real-token'))
      .expect(404);
  });

  it('returns conflict for reused finalize tokens', async () => {
    const initiate = await request(app.getHttpServer())
      .post(apiPath('/enrollments/initiate'))
      .send({
        email: 'admin@example.com',
        hostname: 'srv-enroll-06',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(apiPath(`/enrollments/${initiate.body.token}/finalize`))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: 'admin@example.com',
        nodeName: 'Enrollment Node 06',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(apiPath(`/enrollments/${initiate.body.token}/finalize`))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: 'admin@example.com',
        nodeName: 'Enrollment Node 06',
      })
      .expect(409);
  });

  it('auto-revokes expired pending enrollments when polled and blocks finalization', async () => {
    const initiate = await request(app.getHttpServer())
      .post(apiPath('/enrollments/initiate'))
      .send({
        email: 'admin@example.com',
        hostname: 'srv-enroll-07',
      })
      .expect(201);

    await dataSource.getRepository(EnrollmentEntity).update(
      {
        tokenLookupHash: enrollmentTokensService.createLookupHash(
          initiate.body.token,
        ),
      },
      {
        expiresAt: new Date(Date.now() - 60_000),
      },
    );

    await request(app.getHttpServer())
      .get(apiPath(`/enrollments/${initiate.body.token}`))
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({
          status: 'revoked',
        });
      });

    await request(app.getHttpServer())
      .post(apiPath(`/enrollments/${initiate.body.token}/finalize`))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: 'admin@example.com',
        nodeName: 'Enrollment Node 07',
      })
      .expect(410);
  });

  it('allows only workspace admins to generate one-click install commands', async () => {
    const workspaces = await request(app.getHttpServer())
      .get(apiPath('/workspaces'))
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const workspaceId = workspaces.body[0]?.id as string;

    await request(app.getHttpServer())
      .post(apiPath(`/workspaces/${workspaceId}/node-installs`))
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        nodeName: 'Bootstrap Node 01',
      })
      .expect(403);
  });

  it('creates and consumes one-click node install tokens', async () => {
    const workspaces = await request(app.getHttpServer())
      .get(apiPath('/workspaces'))
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const workspaceId = workspaces.body[0]?.id as string;

    const team = await request(app.getHttpServer())
      .post(apiPath(`/workspaces/${workspaceId}/teams`))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Operations',
      })
      .expect(201);

    const createInstall = await request(app.getHttpServer())
      .post(apiPath(`/workspaces/${workspaceId}/node-installs`))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        nodeName: 'Bootstrap Node 02',
        description: 'One-click install test node',
        teamId: team.body.id,
      })
      .expect(201);

    expect(createInstall.body.installId).toEqual(expect.any(String));
    expect(createInstall.body.apiUrl).toBe('https://api.example.com');
    expect(createInstall.body.scriptUrl).toBe(
      'https://cdn.example.com/noderax-agent/install.sh',
    );
    expect(createInstall.body.installCommand).toContain(
      "curl -fsSL 'https://cdn.example.com/noderax-agent/install.sh'",
    );

    const bootstrapToken = extractBootstrapToken(
      createInstall.body.installCommand,
    );
    const consume = await request(app.getHttpServer())
      .post(apiPath('/node-installs/consume'))
      .send({
        token: bootstrapToken,
        hostname: 'srv-bootstrap-02',
        additionalInfo: {
          os: 'ubuntu-24.04',
          arch: 'arm64',
          agentVersion: '1.2.3',
          platformVersion: 'Ubuntu 24.04',
          kernelVersion: '6.8.0',
        },
      })
      .expect(201);

    expect(consume.body.nodeId).toEqual(expect.any(String));
    expect(consume.body.agentToken).toEqual(expect.any(String));

    await request(app.getHttpServer())
      .get(apiPath(`/workspaces/${workspaceId}/nodes/${consume.body.nodeId}`))
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.name).toBe('Bootstrap Node 02');
        expect(body.description).toBe('One-click install test node');
        expect(body.hostname).toBe('srv-bootstrap-02');
        expect(body.os).toBe('ubuntu-24.04');
        expect(body.arch).toBe('arm64');
        expect(body.teamId).toBe(team.body.id);
        expect(body.agentVersion).toBe('1.2.3');
        expect(body.platformVersion).toBe('Ubuntu 24.04');
        expect(body.kernelVersion).toBe('6.8.0');
      });

    const nodeInstall = await dataSource
      .getRepository(NodeInstallEntity)
      .findOneByOrFail({
        id: createInstall.body.installId,
      });
    expect(nodeInstall.hostname).toBe('srv-bootstrap-02');
    expect(nodeInstall.nodeId).toBe(consume.body.nodeId);
    expect(nodeInstall.consumedAt).toBeTruthy();

    await request(app.getHttpServer())
      .post(apiPath('/node-installs/consume'))
      .send({
        token: bootstrapToken,
        hostname: 'srv-bootstrap-02',
      })
      .expect(409);
  });

  it('rejects expired one-click node install tokens', async () => {
    const workspaces = await request(app.getHttpServer())
      .get(apiPath('/workspaces'))
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const workspaceId = workspaces.body[0]?.id as string;

    const createInstall = await request(app.getHttpServer())
      .post(apiPath(`/workspaces/${workspaceId}/node-installs`))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        nodeName: 'Bootstrap Node 03',
      })
      .expect(201);

    const installRepository = dataSource.getRepository(NodeInstallEntity);
    const nodeInstall = await installRepository.findOneByOrFail({
      id: createInstall.body.installId,
    });
    nodeInstall.expiresAt = new Date(Date.now() - 60_000);
    await installRepository.save(nodeInstall);

    await request(app.getHttpServer())
      .post(apiPath('/node-installs/consume'))
      .send({
        token: extractBootstrapToken(createInstall.body.installCommand),
        hostname: 'srv-bootstrap-03',
      })
      .expect(410);
  });
});
