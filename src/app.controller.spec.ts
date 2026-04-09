import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AgentRealtimeService } from './modules/agent-realtime/agent-realtime.service';
import { AgentUpdatesService } from './modules/agent-updates/agent-updates.service';
import { RealtimeGateway } from './modules/realtime/realtime.gateway';
import { TasksService } from './modules/tasks/tasks.service';
import { TaskStaleDetectorService } from './modules/tasks/task-stale-detector.service';
import { TerminalSessionsService } from './modules/terminal-sessions/terminal-sessions.service';
import { RedisService } from './redis/redis.service';
import { ClusterLockService } from './runtime/cluster-lock.service';
import { PrometheusMetricsService } from './runtime/prometheus-metrics.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: DataSource,
          useValue: {
            isInitialized: true,
            query: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
            showMigrations: jest.fn().mockResolvedValue(false),
          },
        },
        {
          provide: RedisService,
          useValue: {
            isEnabled: jest.fn().mockReturnValue(false),
            ping: jest.fn().mockResolvedValue(true),
            getHealthSnapshot: jest.fn().mockReturnValue({
              enabled: false,
              status: 'disabled',
              subscriberStatus: 'disabled',
              instanceId: 'test',
            }),
          },
        },
        {
          provide: ClusterLockService,
          useValue: {
            getInstanceId: jest.fn().mockReturnValue('lock-owner'),
            getSnapshots: jest.fn().mockReturnValue([]),
          },
        },
        {
          provide: PrometheusMetricsService,
          useValue: {
            setGauge: jest.fn(),
            incrementCounter: jest.fn(),
            observeSummary: jest.fn(),
            renderPrometheus: jest.fn().mockReturnValue('# metrics\n'),
          },
        },
        {
          provide: TasksService,
          useValue: {
            getClaimStatsSnapshot: jest.fn().mockReturnValue({
              claim_request_total: 0,
              claim_success_total: 0,
              claim_empty_total: 0,
              claim_error_total: 0,
            }),
          },
        },
        {
          provide: TaskStaleDetectorService,
          useValue: {
            getOperationalSnapshot: jest.fn().mockReturnValue({
              lastFailedCount: 0,
              totalFailedCount: 0,
            }),
          },
        },
        {
          provide: AgentRealtimeService,
          useValue: {
            getRealtimeHealthSnapshot: jest.fn().mockReturnValue({
              realtimeConnected: false,
              lastAgentSeenAt: null,
            }),
            getActiveConnectionCount: jest.fn().mockReturnValue(0),
          },
        },
        {
          provide: TerminalSessionsService,
          useValue: {
            getRuntimeSnapshot: jest.fn().mockReturnValue({
              attachedControllerCount: 0,
              activeSessionCount: 0,
            }),
          },
        },
        {
          provide: AgentUpdatesService,
          useValue: {
            getOperationalSnapshot: jest.fn().mockResolvedValue({
              activeTargetCount: 0,
              failedTargetCount: 0,
            }),
          },
        },
        {
          provide: RealtimeGateway,
          useValue: {
            getActiveConnectionCount: jest.fn().mockReturnValue(0),
          },
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('health', () => {
    it('should return the API health payload', () => {
      expect(appController.getHealth()).toMatchObject({
        service: 'noderax-api',
        status: 'ok',
      });
      expect(appController.getHealth().startedAt).toEqual(expect.any(String));
      expect(appController.getHealth().bootId).toEqual(expect.any(String));
    });
  });

  describe('metrics', () => {
    it('should return the Prometheus payload', async () => {
      await expect(appController.getPrometheusMetrics()).resolves.toContain(
        '# metrics',
      );
    });
  });
});
