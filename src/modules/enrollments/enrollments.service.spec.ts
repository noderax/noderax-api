import { Repository } from 'typeorm';
import { NodesService } from '../nodes/nodes.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UsersService } from '../users/users.service';
import { EnrollmentEntity } from './entities/enrollment.entity';
import { EnrollmentStatus } from './entities/enrollment-status.enum';
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
  let enrollmentTokensService: jest.Mocked<EnrollmentTokensService>;
  let usersService: jest.Mocked<UsersService>;
  let nodesService: jest.Mocked<NodesService>;
  let notificationsService: jest.Mocked<NotificationsService>;
  let service: EnrollmentsService;

  beforeEach(() => {
    enrollmentsRepository = {
      create: jest.fn((value) => value),
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn(async (value) => value),
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

    service = new EnrollmentsService(
      enrollmentsRepository as unknown as Repository<EnrollmentEntity>,
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
    );
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
});
