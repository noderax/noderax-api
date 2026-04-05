import { Repository } from 'typeorm';
import { Request } from 'express';
import { RedisService } from '../../redis/redis.service';
import { NodesService } from '../nodes/nodes.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { UsersService } from '../users/users.service';
import { EnrollmentEntity } from './entities/enrollment.entity';
import { EnrollmentStatus } from './entities/enrollment-status.enum';
import { NodeInstallEntity } from './entities/node-install.entity';
import { NodeInstallStatus } from './entities/node-install-status.enum';
import { EnrollmentTokensService } from './enrollment-tokens.service';
import { EnrollmentsService } from './enrollments.service';

type MockRepository<T> = Partial<
  Record<keyof Repository<T>, jest.Mock | Repository<T>[keyof Repository<T>]>
> & {
  create: jest.Mock;
  find: jest.Mock;
  save: jest.Mock;
  createQueryBuilder: jest.Mock;
};

function createQueryBuilderMock(result: EnrollmentEntity | null) {
  return {
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(result),
  };
}

function buildEnrollment(
  partial: Partial<EnrollmentEntity> = {},
): EnrollmentEntity {
  return {
    id: '0f192eb9-9e54-44b8-bf82-0de5ba6ddf4f',
    workspaceId: 'workspace-1',
    email: 'admin@example.com',
    tokenHash: 'token-hash',
    tokenLookupHash: 'lookup-hash',
    hostname: 'srv-enroll-01',
    additionalInfo: null,
    createdAt: new Date('2026-03-19T10:00:00.000Z'),
    expiresAt: new Date(Date.now() + 60_000),
    status: EnrollmentStatus.PENDING,
    nodeId: null,
    agentToken: null,
    ...partial,
  };
}

describe('EnrollmentsService', () => {
  let enrollmentsRepository: MockRepository<EnrollmentEntity>;
  let nodeInstallsRepository: MockRepository<NodeInstallEntity>;
  let enrollmentTokensService: jest.Mocked<EnrollmentTokensService>;
  let usersService: jest.Mocked<UsersService>;
  let nodesService: jest.Mocked<NodesService>;
  let notificationsService: jest.Mocked<NotificationsService>;
  let realtimeGateway: jest.Mocked<RealtimeGateway>;
  let redisService: jest.Mocked<RedisService>;
  let configService: { getOrThrow: jest.Mock };
  let service: EnrollmentsService;

  beforeEach(() => {
    enrollmentsRepository = {
      create: jest.fn((value) => value),
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn(async (value) => value),
      createQueryBuilder: jest.fn(),
    };
    nodeInstallsRepository = {
      create: jest.fn((value) => value),
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn(async (value: any) => ({
        id: 'node-install-1',
        createdAt: new Date('2026-03-31T23:19:00.000Z'),
        updatedAt: new Date('2026-03-31T23:19:00.000Z'),
        ...(value || {}),
      })),
      createQueryBuilder: jest.fn(),
    };

    enrollmentTokensService = {
      issueEnrollmentToken: jest.fn(),
      issueAgentToken: jest.fn(),
      createLookupHash: jest.fn().mockReturnValue('lookup-hash'),
      hashToken: jest.fn(),
      verifyToken: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<EnrollmentTokensService>;

    usersService = {
      findByEmail: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<UsersService>;

    nodesService = {
      createFromEnrollment: jest.fn().mockResolvedValue({
        id: 'b7f88611-b63e-4c95-9f37-4afb5c0cf275',
      }),
      hashAgentToken: jest.fn().mockReturnValue('agent-token-hash'),
    } as unknown as jest.Mocked<NodesService>;

    notificationsService = {
      notifyEnrollmentInitiated: jest.fn(),
    } as unknown as jest.Mocked<NotificationsService>;

    realtimeGateway = {
      emitNodeInstallUpdated: jest.fn(),
    } as unknown as jest.Mocked<RealtimeGateway>;

    redisService = {
      publish: jest.fn().mockResolvedValue(1),
      getInstanceId: jest.fn().mockReturnValue('instance-1'),
    } as unknown as jest.Mocked<RedisService>;

    configService = {
      getOrThrow: jest.fn().mockReturnValue({
        publicApiUrl: 'https://api.example.com',
        installScriptUrl: 'https://cdn.example.com/install.sh',
      }),
    };

    service = new EnrollmentsService(
      enrollmentsRepository as unknown as Repository<EnrollmentEntity>,
      nodeInstallsRepository as unknown as Repository<NodeInstallEntity>,
      enrollmentTokensService,
      usersService,
      nodesService,
      notificationsService,
      {
        getDefaultWorkspaceOrFail: jest.fn().mockResolvedValue({
          id: 'workspace-1',
        }),
        assertWorkspaceWritable: jest.fn().mockResolvedValue({
          id: 'workspace-1',
        }),
      } as never,
      configService as never,
      realtimeGateway,
      redisService,
    );
  });

  afterEach(() => {
    delete process.env.AGENT_PUBLIC_API_URL;
  });

  it('approves a pending enrollment and defaults os/arch to unknown when metadata is missing', async () => {
    const enrollment = buildEnrollment();
    enrollmentsRepository.createQueryBuilder.mockReturnValue(
      createQueryBuilderMock(enrollment),
    );
    enrollmentTokensService.issueAgentToken.mockReturnValue('agent-token');

    const result = await service.finalize('raw-token', {
      email: 'admin@example.com',
      nodeName: 'Enrollment Node',
    });

    expect(enrollmentTokensService.verifyToken).toHaveBeenCalledWith({
      token: 'raw-token',
      tokenHash: 'token-hash',
      tokenLookupHash: 'lookup-hash',
    });
    expect(nodesService.createFromEnrollment).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      name: 'Enrollment Node',
      description: null,
      hostname: 'srv-enroll-01',
      os: 'unknown',
      arch: 'unknown',
      agentTokenHash: 'agent-token-hash',
      agentVersion: null,
      platformVersion: null,
      kernelVersion: null,
    });
    expect(result).toEqual({
      nodeId: 'b7f88611-b63e-4c95-9f37-4afb5c0cf275',
      agentToken: 'agent-token',
    });
    expect(enrollmentsRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: EnrollmentStatus.APPROVED,
        nodeId: 'b7f88611-b63e-4c95-9f37-4afb5c0cf275',
        agentToken: 'agent-token',
      }),
    );
  });

  it('auto-revokes expired pending enrollments when polled', async () => {
    const enrollment = buildEnrollment({
      expiresAt: new Date(Date.now() - 60_000),
    });
    enrollmentsRepository.createQueryBuilder.mockReturnValue(
      createQueryBuilderMock(enrollment),
    );

    const result = await service.getStatus('raw-token');

    expect(result).toEqual({
      status: EnrollmentStatus.REVOKED,
    });
    expect(enrollmentsRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: EnrollmentStatus.REVOKED,
      }),
    );
  });

  it('waits for enrollment notification delivery before resolving', async () => {
    enrollmentTokensService.issueEnrollmentToken.mockResolvedValue({
      token: 'raw-token',
      tokenHash: 'token-hash',
      tokenLookupHash: 'lookup-hash',
    });

    let resolveNotification: (() => void) | null = null;
    let markNotificationStarted: (() => void) | null = null;
    const notificationStarted = new Promise<void>((resolve) => {
      markNotificationStarted = resolve;
    });
    notificationsService.notifyEnrollmentInitiated.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          markNotificationStarted?.();
          resolveNotification = resolve;
        }),
    );

    const initiatePromise = service.initiate({
      email: 'admin@example.com',
      hostname: 'srv-enroll-01',
    });

    await notificationStarted;
    expect(resolveNotification).toEqual(expect.any(Function));

    const raceResult = await Promise.race([
      initiatePromise.then(() => 'resolved'),
      Promise.resolve('pending'),
    ]);

    expect(raceResult).toBe('pending');

    resolveNotification?.();
    const result = await initiatePromise;

    expect(result).toEqual({
      token: 'raw-token',
      expiresAt: expect.any(Date),
    });
    expect(enrollmentsRepository.save).toHaveBeenCalled();
    expect(notificationsService.notifyEnrollmentInitiated).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'admin@example.com',
        hostname: 'srv-enroll-01',
        hasKnownUser: false,
      }),
    );
  });

  it('creates node installs with an initial pending progress state', async () => {
    enrollmentTokensService.issueEnrollmentToken.mockResolvedValue({
      token: 'raw-install-token',
      tokenHash: 'token-hash',
      tokenLookupHash: 'lookup-hash',
    });

    const result = await service.createNodeInstall('workspace-1', {
      nodeName: 'Production Node',
      description: 'Bootstrap this server',
    });

    expect(nodeInstallsRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        status: NodeInstallStatus.PENDING,
        stage: 'command_generated',
        progressPercent: 5,
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        installId: expect.anything(),
        status: NodeInstallStatus.PENDING,
        stage: 'command_generated',
        progressPercent: 5,
      }),
    );
  });

  it('prefers the proxied public API header over a localhost agent API configuration', async () => {
    process.env.AGENT_PUBLIC_API_URL = 'http://localhost:3000';
    configService.getOrThrow.mockReturnValue({
      publicApiUrl: 'http://localhost:3000',
      installScriptUrl: 'https://cdn.example.com/install.sh',
    });
    enrollmentTokensService.issueEnrollmentToken.mockResolvedValue({
      token: 'raw-install-token',
      tokenHash: 'token-hash',
      tokenLookupHash: 'lookup-hash',
    });

    const request = {
      headers: {
        'x-noderax-public-api-url': 'https://api.noderax.net/api/v1',
      },
      protocol: 'https',
    } as Partial<Request> as Request;

    const result = await service.createNodeInstall(
      'workspace-1',
      {
        nodeName: 'Production Node',
      },
      request,
    );

    expect(result.apiUrl).toBe('https://api.noderax.net');
    expect(result.installCommand).toContain(
      "--api-url 'https://api.noderax.net'",
    );

    delete process.env.AGENT_PUBLIC_API_URL;
  });
});
