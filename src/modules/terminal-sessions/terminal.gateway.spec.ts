import { TerminalGateway } from './terminal.gateway';
import { TerminalSocketAuthService } from './terminal-socket-auth.service';
import { TerminalSessionsService } from './terminal-sessions.service';

describe('TerminalGateway', () => {
  let gateway: TerminalGateway;
  let terminalSocketAuthService: jest.Mocked<TerminalSocketAuthService>;
  let terminalSessionsService: jest.Mocked<TerminalSessionsService>;

  const buildClient = () =>
    ({
      id: 'socket-1',
      data: {
        user: {
          id: 'd9733a3e-5c0d-4791-9ec2-21a0b78d174f',
          email: 'operator@noderax.test',
        },
        terminalSessionAuth: {
          sessionId: '9ea30193-3c8c-4d3a-b1ab-3428a8a25735',
          workspaceId: '1351cc10-1cd8-44bd-bceb-e1d16f0e49cf',
        },
      },
      emit: jest.fn(),
    }) as never;

  beforeEach(() => {
    terminalSocketAuthService = {
      authenticateSocket: jest.fn(),
    } as unknown as jest.Mocked<TerminalSocketAuthService>;

    terminalSessionsService = {
      bindRoomEmitter: jest.fn(),
      detachController: jest.fn(),
      handleControllerInput: jest.fn(),
    } as unknown as jest.Mocked<TerminalSessionsService>;

    gateway = new TerminalGateway(
      terminalSocketAuthService,
      terminalSessionsService,
    );
  });

  it('allows sustained input bursts within the terminal input rate limit', async () => {
    const client = buildClient();
    const payload = {
      sessionId: '9ea30193-3c8c-4d3a-b1ab-3428a8a25735',
      payload: 'YQ==',
    };

    for (let index = 0; index < 600; index += 1) {
      await expect(gateway.input(client, payload)).resolves.toEqual({
        ok: true,
        sessionId: payload.sessionId,
      });
    }

    expect(terminalSessionsService.handleControllerInput).toHaveBeenCalledTimes(
      600,
    );
  });

  it('rejects terminal input above the socket rate limit window', async () => {
    const client = buildClient();
    const payload = {
      sessionId: '9ea30193-3c8c-4d3a-b1ab-3428a8a25735',
      payload: 'YQ==',
    };

    for (let index = 0; index < 600; index += 1) {
      await gateway.input(client, payload);
    }

    await expect(gateway.input(client, payload)).resolves.toEqual({
      ok: false,
      message: 'Terminal input rate limit exceeded for this socket.',
    });
  });
});
