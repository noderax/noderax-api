import { EventSeverity } from '../events/entities/event-severity.enum';
import { NotificationsService } from './notifications.service';

describe('NotificationsService node-level delivery filters', () => {
  let usersRepository: { find: jest.Mock; findOne: jest.Mock };
  let workspaceMembershipsRepository: { find: jest.Mock };
  let workspacesRepository: { findOne: jest.Mock };
  let nodesRepository: { findOne: jest.Mock };
  let mailerService: { sendMail: jest.Mock };
  let configService: { getOrThrow: jest.Mock };
  let service: NotificationsService;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    usersRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
    };
    workspaceMembershipsRepository = {
      find: jest.fn().mockResolvedValue([{ userId: 'workspace-admin-1' }]),
    };
    workspacesRepository = {
      findOne: jest.fn(),
    };
    nodesRepository = {
      findOne: jest.fn(),
    };
    mailerService = {
      sendMail: jest.fn().mockResolvedValue(undefined),
    };
    configService = {
      getOrThrow: jest.fn().mockReturnValue({
        webAppUrl: 'https://app.noderax.test',
      }),
    };
    fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      text: jest.fn().mockResolvedValue(''),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    service = new NotificationsService(
      usersRepository as never,
      workspaceMembershipsRepository as never,
      workspacesRepository as never,
      nodesRepository as never,
      mailerService as never,
      configService as never,
    );
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('sends email for node-scoped events when workspace and node email delivery are enabled', async () => {
    workspacesRepository.findOne.mockResolvedValue({
      id: 'workspace-1',
      name: 'Default Workspace',
      automationEmailEnabled: true,
      automationTelegramEnabled: false,
      automationEmailLevels: [EventSeverity.WARNING, EventSeverity.CRITICAL],
      automationTelegramLevels: [EventSeverity.CRITICAL],
      automationTelegramBotToken: null,
      automationTelegramChatId: null,
    });
    nodesRepository.findOne.mockResolvedValue({
      id: 'node-1',
      name: 'srv-01',
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
    });
    usersRepository.find.mockImplementation(async ({ where }) => {
      if ('role' in where) {
        return [];
      }

      if ('criticalEventEmailsEnabled' in where) {
        return [];
      }

      return [{ email: 'workspace-admin@example.com' }];
    });

    await service.notifyEvent({
      id: 'event-1',
      workspaceId: 'workspace-1',
      nodeId: 'node-1',
      type: 'node.maintenance.enabled',
      severity: EventSeverity.WARNING,
      message: 'Maintenance enabled',
      createdAt: new Date('2026-04-05T12:00:00.000Z'),
    } as never);

    expect(mailerService.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ['workspace-admin@example.com'],
      }),
    );
  });

  it('suppresses all node-scoped email when node email delivery is disabled', async () => {
    workspacesRepository.findOne.mockResolvedValue({
      id: 'workspace-1',
      name: 'Default Workspace',
      automationEmailEnabled: true,
      automationTelegramEnabled: false,
      automationEmailLevels: [EventSeverity.CRITICAL],
      automationTelegramLevels: [EventSeverity.CRITICAL],
      automationTelegramBotToken: null,
      automationTelegramChatId: null,
    });
    nodesRepository.findOne.mockResolvedValue({
      id: 'node-1',
      name: 'srv-01',
      notificationEmailEnabled: false,
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
    });

    await service.notifyEvent({
      id: 'event-1',
      workspaceId: 'workspace-1',
      nodeId: 'node-1',
      type: 'high.cpu',
      severity: EventSeverity.CRITICAL,
      message: 'CPU is too high',
      createdAt: new Date('2026-04-05T12:00:00.000Z'),
    } as never);

    expect(mailerService.sendMail).not.toHaveBeenCalled();
  });

  it('suppresses node-scoped email when the workspace email channel is disabled', async () => {
    workspacesRepository.findOne.mockResolvedValue({
      id: 'workspace-1',
      name: 'Default Workspace',
      automationEmailEnabled: false,
      automationTelegramEnabled: false,
      automationEmailLevels: [EventSeverity.CRITICAL],
      automationTelegramLevels: [EventSeverity.CRITICAL],
      automationTelegramBotToken: null,
      automationTelegramChatId: null,
    });
    nodesRepository.findOne.mockResolvedValue({
      id: 'node-1',
      name: 'srv-01',
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
    });

    await service.notifyEvent({
      id: 'event-1',
      workspaceId: 'workspace-1',
      nodeId: 'node-1',
      type: 'high.cpu',
      severity: EventSeverity.CRITICAL,
      message: 'CPU is too high',
      createdAt: new Date('2026-04-05T12:00:00.000Z'),
    } as never);

    expect(mailerService.sendMail).not.toHaveBeenCalled();
  });

  it('suppresses Telegram delivery when node Telegram notifications are disabled', async () => {
    workspacesRepository.findOne.mockResolvedValue({
      id: 'workspace-1',
      name: 'Default Workspace',
      automationEmailEnabled: false,
      automationTelegramEnabled: true,
      automationEmailLevels: [EventSeverity.CRITICAL],
      automationTelegramLevels: [EventSeverity.WARNING, EventSeverity.CRITICAL],
      automationTelegramBotToken: 'token',
      automationTelegramChatId: '-100123',
    });
    nodesRepository.findOne.mockResolvedValue({
      id: 'node-1',
      name: 'srv-01',
      notificationEmailEnabled: true,
      notificationEmailLevels: [
        EventSeverity.INFO,
        EventSeverity.WARNING,
        EventSeverity.CRITICAL,
      ],
      notificationTelegramEnabled: false,
      notificationTelegramLevels: [
        EventSeverity.INFO,
        EventSeverity.WARNING,
        EventSeverity.CRITICAL,
      ],
    });

    await service.notifyEvent({
      id: 'event-1',
      workspaceId: 'workspace-1',
      nodeId: 'node-1',
      type: 'node.maintenance.enabled',
      severity: EventSeverity.WARNING,
      message: 'Maintenance enabled',
      createdAt: new Date('2026-04-05T12:00:00.000Z'),
    } as never);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('suppresses all node-scoped email when the node email levels exclude the event severity', async () => {
    workspacesRepository.findOne.mockResolvedValue({
      id: 'workspace-1',
      name: 'Default Workspace',
      automationEmailEnabled: true,
      automationTelegramEnabled: false,
      automationEmailLevels: [
        EventSeverity.INFO,
        EventSeverity.WARNING,
        EventSeverity.CRITICAL,
      ],
      automationTelegramLevels: [EventSeverity.CRITICAL],
      automationTelegramBotToken: null,
      automationTelegramChatId: null,
    });
    nodesRepository.findOne.mockResolvedValue({
      id: 'node-1',
      name: 'srv-01',
      notificationEmailEnabled: true,
      notificationEmailLevels: [EventSeverity.INFO, EventSeverity.WARNING],
      notificationTelegramEnabled: true,
      notificationTelegramLevels: [
        EventSeverity.INFO,
        EventSeverity.WARNING,
        EventSeverity.CRITICAL,
      ],
    });

    await service.notifyEvent({
      id: 'event-1',
      workspaceId: 'workspace-1',
      nodeId: 'node-1',
      type: 'high.cpu',
      severity: EventSeverity.CRITICAL,
      message: 'CPU is too high',
      createdAt: new Date('2026-04-05T12:00:00.000Z'),
    } as never);

    expect(mailerService.sendMail).not.toHaveBeenCalled();
  });

  it('suppresses Telegram delivery when the node Telegram levels exclude the event severity', async () => {
    workspacesRepository.findOne.mockResolvedValue({
      id: 'workspace-1',
      name: 'Default Workspace',
      automationEmailEnabled: false,
      automationTelegramEnabled: true,
      automationEmailLevels: [EventSeverity.CRITICAL],
      automationTelegramLevels: [
        EventSeverity.INFO,
        EventSeverity.WARNING,
        EventSeverity.CRITICAL,
      ],
      automationTelegramBotToken: 'token',
      automationTelegramChatId: '-100123',
    });
    nodesRepository.findOne.mockResolvedValue({
      id: 'node-1',
      name: 'srv-01',
      notificationEmailEnabled: true,
      notificationEmailLevels: [
        EventSeverity.INFO,
        EventSeverity.WARNING,
        EventSeverity.CRITICAL,
      ],
      notificationTelegramEnabled: true,
      notificationTelegramLevels: [EventSeverity.WARNING],
    });

    await service.notifyEvent({
      id: 'event-1',
      workspaceId: 'workspace-1',
      nodeId: 'node-1',
      type: 'high.cpu',
      severity: EventSeverity.CRITICAL,
      message: 'CPU is too high',
      createdAt: new Date('2026-04-05T12:00:00.000Z'),
    } as never);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('suppresses Telegram delivery when the workspace Telegram channel is disabled', async () => {
    workspacesRepository.findOne.mockResolvedValue({
      id: 'workspace-1',
      name: 'Default Workspace',
      automationEmailEnabled: false,
      automationTelegramEnabled: false,
      automationEmailLevels: [EventSeverity.CRITICAL],
      automationTelegramLevels: [EventSeverity.WARNING, EventSeverity.CRITICAL],
      automationTelegramBotToken: 'token',
      automationTelegramChatId: '-100123',
    });
    nodesRepository.findOne.mockResolvedValue({
      id: 'node-1',
      name: 'srv-01',
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
    });

    await service.notifyEvent({
      id: 'event-1',
      workspaceId: 'workspace-1',
      nodeId: 'node-1',
      type: 'node.maintenance.enabled',
      severity: EventSeverity.WARNING,
      message: 'Maintenance enabled',
      createdAt: new Date('2026-04-05T12:00:00.000Z'),
    } as never);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still sends email when Telegram delivery fails', async () => {
    workspacesRepository.findOne.mockResolvedValue({
      id: 'workspace-1',
      name: 'Default Workspace',
      automationEmailEnabled: true,
      automationTelegramEnabled: true,
      automationEmailLevels: [EventSeverity.WARNING, EventSeverity.CRITICAL],
      automationTelegramLevels: [EventSeverity.WARNING, EventSeverity.CRITICAL],
      automationTelegramBotToken: 'token',
      automationTelegramChatId: '-100123',
    });
    nodesRepository.findOne.mockResolvedValue({
      id: 'node-1',
      name: 'srv-01',
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
    });
    usersRepository.find.mockImplementation(async ({ where }) => {
      if ('role' in where) {
        return [];
      }

      if ('criticalEventEmailsEnabled' in where) {
        return [];
      }

      return [{ email: 'workspace-admin@example.com' }];
    });
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: jest.fn().mockResolvedValue('unauthorized'),
    });

    await service.notifyEvent({
      id: 'event-1',
      workspaceId: 'workspace-1',
      nodeId: 'node-1',
      type: 'node.maintenance.enabled',
      severity: EventSeverity.WARNING,
      message: 'Maintenance enabled',
      createdAt: new Date('2026-04-05T12:00:00.000Z'),
    } as never);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mailerService.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ['workspace-admin@example.com'],
      }),
    );
  });

  it('throws when Telegram delivery fails and error propagation is enabled', async () => {
    workspacesRepository.findOne.mockResolvedValue({
      id: 'workspace-1',
      name: 'Default Workspace',
      automationEmailEnabled: false,
      automationTelegramEnabled: true,
      automationEmailLevels: [EventSeverity.WARNING, EventSeverity.CRITICAL],
      automationTelegramLevels: [EventSeverity.WARNING, EventSeverity.CRITICAL],
      automationTelegramBotToken: 'token',
      automationTelegramChatId: '-100123',
    });
    nodesRepository.findOne.mockResolvedValue({
      id: 'node-1',
      name: 'srv-01',
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
    });
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: jest.fn().mockResolvedValue('unauthorized'),
    });

    await expect(
      service.notifyEvent(
        {
          id: 'event-1',
          workspaceId: 'workspace-1',
          nodeId: 'node-1',
          type: 'node.maintenance.enabled',
          severity: EventSeverity.WARNING,
          message: 'Maintenance enabled',
          createdAt: new Date('2026-04-05T12:00:00.000Z'),
        } as never,
        { propagateErrors: true },
      ),
    ).rejects.toThrow(/Event notification delivery failed/);
  });

  it('does not throw when Telegram succeeds and email fails with error propagation enabled', async () => {
    workspacesRepository.findOne.mockResolvedValue({
      id: 'workspace-1',
      name: 'Default Workspace',
      automationEmailEnabled: true,
      automationTelegramEnabled: true,
      automationEmailLevels: [EventSeverity.WARNING, EventSeverity.CRITICAL],
      automationTelegramLevels: [EventSeverity.WARNING, EventSeverity.CRITICAL],
      automationTelegramBotToken: 'token',
      automationTelegramChatId: '-100123',
    });
    nodesRepository.findOne.mockResolvedValue({
      id: 'node-1',
      name: 'srv-01',
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
    });
    usersRepository.find.mockImplementation(async ({ where }) => {
      if ('role' in where) {
        return [];
      }

      if ('criticalEventEmailsEnabled' in where) {
        return [];
      }

      return [{ email: 'workspace-admin@example.com' }];
    });
    mailerService.sendMail.mockRejectedValueOnce(new Error('smtp failed'));

    await expect(
      service.notifyEvent(
        {
          id: 'event-1',
          workspaceId: 'workspace-1',
          nodeId: 'node-1',
          type: 'node.maintenance.enabled',
          severity: EventSeverity.WARNING,
          message: 'Maintenance enabled',
          createdAt: new Date('2026-04-05T12:00:00.000Z'),
        } as never,
        { propagateErrors: true },
      ),
    ).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mailerService.sendMail).toHaveBeenCalledTimes(1);
  });

  it('preserves the existing critical email behavior for workspace-scoped events without a node id', async () => {
    workspacesRepository.findOne.mockResolvedValue({
      id: 'workspace-1',
      name: 'Default Workspace',
      automationEmailEnabled: false,
      automationTelegramEnabled: false,
      automationEmailLevels: [EventSeverity.CRITICAL],
      automationTelegramLevels: [EventSeverity.CRITICAL],
      automationTelegramBotToken: null,
      automationTelegramChatId: null,
    });
    usersRepository.find.mockImplementation(async ({ where }) => {
      if ('role' in where) {
        return [{ email: 'platform-admin@example.com' }];
      }

      if ('criticalEventEmailsEnabled' in where) {
        return [{ email: 'workspace-admin@example.com' }];
      }

      return [];
    });

    await service.notifyEvent({
      id: 'event-1',
      workspaceId: 'workspace-1',
      nodeId: null,
      type: 'workspace.policy.changed',
      severity: EventSeverity.CRITICAL,
      message: 'Policy changed',
      createdAt: new Date('2026-04-05T12:00:00.000Z'),
    } as never);

    expect(mailerService.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ['platform-admin@example.com', 'workspace-admin@example.com'],
      }),
    );
  });
});
