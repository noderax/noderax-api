import 'reflect-metadata';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { SYSTEM_EVENT_TYPES } from '../../common/constants/system-event.constants';
import { AuthenticatedUser } from '../../common/types/authenticated-user.type';
import { EventSeverity } from '../events/entities/event-severity.enum';
import { UserRole } from '../users/entities/user-role.enum';
import { NodesService } from './nodes.service';
import { NodeEntity } from './entities/node.entity';
import { NodeRootAccessProfile } from './entities/node-root-access-profile.enum';
import { NodeRootAccessSyncStatus } from './entities/node-root-access-sync-status.enum';

function createService(): NodesService {
  return new NodesService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

function buildNode(partial: Partial<NodeEntity>): NodeEntity {
  return {
    id: 'node-1',
    workspaceId: 'workspace-1',
    name: 'srv-01',
    description: null,
    hostname: 'srv-01.example',
    os: 'ubuntu-24.04',
    arch: 'amd64',
    status: 'online' as NodeEntity['status'],
    notificationEmailEnabled: true,
    notificationEmailLevels: [
      EventSeverity.INFO,
      EventSeverity.WARNING,
      EventSeverity.CRITICAL,
    ],
    notificationTelegramEnabled: true,
    notificationTelegramLevels: [
      EventSeverity.INFO,
      EventSeverity.WARNING,
      EventSeverity.CRITICAL,
    ],
    rootAccessProfile: NodeRootAccessProfile.OFF,
    rootAccessAppliedProfile: NodeRootAccessProfile.OFF,
    rootAccessSyncStatus: NodeRootAccessSyncStatus.PENDING,
    rootAccessLastError: null,
    createdAt: new Date('2026-04-04T10:00:00.000Z'),
    updatedAt: new Date('2026-04-04T10:00:00.000Z'),
    lastSeenAt: null,
    agentTokenHash: null,
    ...partial,
  };
}

describe('NodesService.assertNodeAllowsOperationalRoot', () => {
  let service: NodesService;

  beforeEach(() => {
    service = createService();
  });

  it('allows operational root when applied profile is operational', () => {
    const node = buildNode({
      rootAccessAppliedProfile: NodeRootAccessProfile.OPERATIONAL,
      rootAccessProfile: NodeRootAccessProfile.OPERATIONAL,
      rootAccessSyncStatus: NodeRootAccessSyncStatus.APPLIED,
    });

    expect(() => service.assertNodeAllowsOperationalRoot(node)).not.toThrow();
  });

  it('allows operational root when applied profile is a combined operational profile', () => {
    const node = buildNode({
      rootAccessAppliedProfile: NodeRootAccessProfile.OPERATIONAL_TASK,
      rootAccessProfile: NodeRootAccessProfile.OPERATIONAL_TASK,
      rootAccessSyncStatus: NodeRootAccessSyncStatus.APPLIED,
    });

    expect(() => service.assertNodeAllowsOperationalRoot(node)).not.toThrow();
  });

  it('rejects operational root while desired profile is pending sync', () => {
    const node = buildNode({
      rootAccessAppliedProfile: NodeRootAccessProfile.OFF,
      rootAccessProfile: NodeRootAccessProfile.OPERATIONAL,
      rootAccessSyncStatus: NodeRootAccessSyncStatus.PENDING,
    });

    expect(() => service.assertNodeAllowsOperationalRoot(node)).toThrow(
      BadRequestException,
    );
  });

  it('rejects operational root when desired profile failed to apply', () => {
    const node = buildNode({
      rootAccessAppliedProfile: NodeRootAccessProfile.OFF,
      rootAccessProfile: NodeRootAccessProfile.OPERATIONAL,
      rootAccessSyncStatus: NodeRootAccessSyncStatus.FAILED,
      rootAccessLastError: 'sudo: a password is required',
    });

    expect(() => service.assertNodeAllowsOperationalRoot(node)).toThrow(
      BadRequestException,
    );
  });

  it('rejects operational root for helper-missing failed state', () => {
    const node = buildNode({
      rootAccessAppliedProfile: NodeRootAccessProfile.OFF,
      rootAccessProfile: NodeRootAccessProfile.ALL,
      rootAccessSyncStatus: NodeRootAccessSyncStatus.FAILED,
      rootAccessLastError: 'root profile helper is not installed',
    });

    expect(() => service.assertNodeAllowsOperationalRoot(node)).toThrow(
      BadRequestException,
    );
  });
});

describe('NodesService.updateNotificationSettings', () => {
  const actor: AuthenticatedUser = {
    id: 'user-1',
    email: 'ops@example.com',
    role: UserRole.PLATFORM_ADMIN,
    name: 'Ops',
  };

  it('updates node notification switches and records event plus audit entries', async () => {
    const node = buildNode({
      notificationEmailEnabled: true,
      notificationEmailLevels: [
        EventSeverity.INFO,
        EventSeverity.WARNING,
        EventSeverity.CRITICAL,
      ],
      notificationTelegramEnabled: true,
      notificationTelegramLevels: [
        EventSeverity.INFO,
        EventSeverity.WARNING,
        EventSeverity.CRITICAL,
      ],
      teamId: null,
    });
    const nodesRepository = {
      findOne: jest.fn().mockResolvedValue(node),
      save: jest.fn().mockImplementation(async (input: NodeEntity) => input),
    };
    const workspacesService = {
      assertWorkspaceAdmin: jest.fn().mockResolvedValue(undefined),
      assertWorkspaceWritable: jest.fn().mockResolvedValue(undefined),
      findTeamOrFail: jest.fn(),
    };
    const eventsService = {
      record: jest.fn().mockResolvedValue(undefined),
    };
    const auditLogsService = {
      record: jest.fn().mockResolvedValue(undefined),
    };
    const service = new NodesService(
      nodesRepository as never,
      {} as never,
      eventsService as never,
      {} as never,
      {} as never,
      workspacesService as never,
      auditLogsService as never,
    );

    const result = await service.updateNotificationSettings(
      'node-1',
      'workspace-1',
      actor,
      {
        notificationEmailEnabled: false,
        notificationEmailLevels: [EventSeverity.CRITICAL],
        notificationTelegramEnabled: false,
        notificationTelegramLevels: [EventSeverity.WARNING],
      },
      {
        actorType: 'user',
        actorUserId: actor.id,
        actorEmailSnapshot: actor.email,
      },
    );

    expect(result.notificationEmailEnabled).toBe(false);
    expect(result.notificationEmailLevels).toEqual([EventSeverity.CRITICAL]);
    expect(result.notificationTelegramEnabled).toBe(false);
    expect(result.notificationTelegramLevels).toEqual([EventSeverity.WARNING]);
    expect(nodesRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        notificationEmailEnabled: false,
        notificationEmailLevels: [EventSeverity.CRITICAL],
        notificationTelegramEnabled: false,
        notificationTelegramLevels: [EventSeverity.WARNING],
      }),
    );
    expect(eventsService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeId: 'node-1',
        type: SYSTEM_EVENT_TYPES.NODE_NOTIFICATIONS_UPDATED,
      }),
    );
    expect(auditLogsService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'node.notifications.updated',
        changes: {
          before: {
            notificationEmailEnabled: true,
            notificationEmailLevels: [
              EventSeverity.INFO,
              EventSeverity.WARNING,
              EventSeverity.CRITICAL,
            ],
            notificationTelegramEnabled: true,
            notificationTelegramLevels: [
              EventSeverity.INFO,
              EventSeverity.WARNING,
              EventSeverity.CRITICAL,
            ],
          },
          after: {
            notificationEmailEnabled: false,
            notificationEmailLevels: [EventSeverity.CRITICAL],
            notificationTelegramEnabled: false,
            notificationTelegramLevels: [EventSeverity.WARNING],
          },
        },
      }),
    );
  });

  it('rejects updates when workspace admin validation fails', async () => {
    const node = buildNode({
      notificationEmailEnabled: true,
      notificationEmailLevels: [
        EventSeverity.INFO,
        EventSeverity.WARNING,
        EventSeverity.CRITICAL,
      ],
      notificationTelegramEnabled: true,
      notificationTelegramLevels: [
        EventSeverity.INFO,
        EventSeverity.WARNING,
        EventSeverity.CRITICAL,
      ],
      teamId: null,
    });
    const nodesRepository = {
      findOne: jest.fn().mockResolvedValue(node),
      save: jest.fn(),
    };
    const workspacesService = {
      assertWorkspaceAdmin: jest
        .fn()
        .mockRejectedValue(new ForbiddenException('workspace admin required')),
      assertWorkspaceWritable: jest.fn(),
      findTeamOrFail: jest.fn(),
    };
    const eventsService = {
      record: jest.fn(),
    };
    const auditLogsService = {
      record: jest.fn(),
    };
    const service = new NodesService(
      nodesRepository as never,
      {} as never,
      eventsService as never,
      {} as never,
      {} as never,
      workspacesService as never,
      auditLogsService as never,
    );

    await expect(
      service.updateNotificationSettings('node-1', 'workspace-1', actor, {
        notificationEmailEnabled: false,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(nodesRepository.save).not.toHaveBeenCalled();
    expect(eventsService.record).not.toHaveBeenCalled();
    expect(auditLogsService.record).not.toHaveBeenCalled();
  });
});
