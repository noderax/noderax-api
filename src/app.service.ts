import { Injectable, Optional } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { hostname } from 'os';
import { DataSource } from 'typeorm';
import {
  DependencyHealthResponseDto,
  ReadinessResponseDto,
} from './common/dto/dependency-health-response.dto';
import { HealthResponseDto } from './common/dto/health-response.dto';
import { getInstallStateHealth } from './install/install-state';
import { AgentRealtimeService } from './modules/agent-realtime/agent-realtime.service';
import { AgentUpdatesService } from './modules/agent-updates/agent-updates.service';
import { RealtimeGateway } from './modules/realtime/realtime.gateway';
import { TasksService } from './modules/tasks/tasks.service';
import { TaskStaleDetectorService } from './modules/tasks/task-stale-detector.service';
import { TerminalSessionsService } from './modules/terminal-sessions/terminal-sessions.service';
import { OutboxService } from './modules/outbox/outbox.service';
import { RedisService } from './redis/redis.service';
import { ClusterLockService } from './runtime/cluster-lock.service';
import { PrometheusMetricsService } from './runtime/prometheus-metrics.service';

@Injectable()
export class AppService {
  private readonly startedAt = new Date().toISOString();
  private readonly bootId = randomUUID();
  private readonly instanceId = `${hostname()}-${process.pid}`;

  constructor(
    @Optional()
    private readonly dataSource?: DataSource,
    @Optional()
    private readonly redisService?: RedisService,
    @Optional()
    private readonly clusterLockService?: ClusterLockService,
    @Optional()
    private readonly prometheusMetricsService?: PrometheusMetricsService,
    @Optional()
    private readonly tasksService?: TasksService,
    @Optional()
    private readonly taskStaleDetectorService?: TaskStaleDetectorService,
    @Optional()
    private readonly agentRealtimeService?: AgentRealtimeService,
    @Optional()
    private readonly terminalSessionsService?: TerminalSessionsService,
    @Optional()
    private readonly agentUpdatesService?: AgentUpdatesService,
    @Optional()
    private readonly realtimeGateway?: RealtimeGateway,
    @Optional()
    private readonly outboxService?: OutboxService,
  ) {}

  getHealth(): HealthResponseDto {
    return {
      service: 'noderax-api',
      status: 'ok',
      timestamp: new Date().toISOString(),
      startedAt: this.startedAt,
      bootId: this.bootId,
    };
  }

  async getReadiness(): Promise<ReadinessResponseDto> {
    const checks = await this.buildDependencyChecks();
    const ready = Object.values(checks).every((check) => check.healthy);

    return {
      service: 'noderax-api',
      status: ready ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      ready,
      checks,
    };
  }

  async getDependencyHealth(): Promise<DependencyHealthResponseDto> {
    const checks = await this.buildDependencyChecks();
    const healthy = Object.values(checks).every((check) => check.healthy);

    return {
      service: 'noderax-api',
      status: healthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      checks,
    };
  }

  async assertInstalledSchemaReady(): Promise<void> {
    const migrations = await this.checkMigrations();
    if (!migrations.healthy) {
      throw new Error(
        migrations.detail ?? 'Database has pending or invalid migrations.',
      );
    }
  }

  async getPrometheusMetrics(): Promise<string> {
    if (!this.prometheusMetricsService) {
      return '';
    }

    const redisSnapshot = this.redisService?.getHealthSnapshot() ?? {
      status: 'disabled',
      subscriberStatus: 'disabled',
    };
    const taskClaimStats = this.tasksService?.getClaimStatsSnapshot() ?? {};
    const staleTaskStats =
      this.taskStaleDetectorService?.getOperationalSnapshot() ?? {
        lastFailedCount: 0,
        totalFailedCount: 0,
      };
    const realtimeHealth =
      this.agentRealtimeService?.getRealtimeHealthSnapshot() ?? {
        realtimeConnected: false,
        lastAgentSeenAt: null,
      };
    const terminalHealth =
      this.terminalSessionsService?.getRuntimeSnapshot() ?? {
        attachedControllerCount: 0,
        activeSessionCount: 0,
      };
    const rolloutHealth =
      (await this.agentUpdatesService?.getOperationalSnapshot()) ?? {
        activeTargetCount: 0,
        failedTargetCount: 0,
      };
    const outboxSnapshot =
      (await this.outboxService?.getOperationalSnapshot()) ?? {
        backlogCount: 0,
        dueCount: 0,
        failedCount: 0,
        deadLetterCount: 0,
      };

    this.prometheusMetricsService.setGauge(
      'noderax_runtime_info',
      1,
      {
        boot_id: this.bootId,
        instance_id: this.instanceId,
        lock_owner: this.clusterLockService?.getInstanceId() ?? 'setup-mode',
      },
      'Runtime instance information.',
    );
    this.prometheusMetricsService.setGauge(
      'noderax_redis_healthy',
      (await this.redisService?.ping()) ? 1 : 0,
      { status: redisSnapshot.status },
      'Redis dependency health.',
    );
    this.prometheusMetricsService.setGauge(
      'noderax_realtime_browser_connections',
      this.realtimeGateway?.getActiveConnectionCount() ?? 0,
      {},
      'Active authenticated browser realtime websocket connections.',
    );
    this.prometheusMetricsService.setGauge(
      'noderax_agent_realtime_connections',
      this.agentRealtimeService?.getActiveConnectionCount() ?? 0,
      {
        connected: realtimeHealth.realtimeConnected ? 'true' : 'false',
      },
      'Active authenticated agent realtime websocket connections.',
    );
    this.prometheusMetricsService.setGauge(
      'noderax_terminal_controllers_active',
      terminalHealth.attachedControllerCount,
      {},
      'Active terminal websocket controller attachments on this instance.',
    );
    this.prometheusMetricsService.setGauge(
      'noderax_terminal_sessions_active',
      terminalHealth.activeSessionCount,
      {},
      'Active terminal sessions on this instance.',
    );
    this.prometheusMetricsService.setGauge(
      'noderax_task_claim_total',
      taskClaimStats.claim_request_total ?? 0,
      { outcome: 'request' },
      'Task claim counters grouped by outcome.',
    );
    this.prometheusMetricsService.setGauge(
      'noderax_task_claim_total',
      taskClaimStats.claim_success_total ?? 0,
      { outcome: 'success' },
      'Task claim counters grouped by outcome.',
    );
    this.prometheusMetricsService.setGauge(
      'noderax_task_claim_total',
      taskClaimStats.claim_empty_total ?? 0,
      { outcome: 'empty' },
      'Task claim counters grouped by outcome.',
    );
    this.prometheusMetricsService.setGauge(
      'noderax_task_claim_total',
      taskClaimStats.claim_error_total ?? 0,
      { outcome: 'error' },
      'Task claim counters grouped by outcome.',
    );
    this.prometheusMetricsService.setGauge(
      'noderax_stale_tasks_last_failed_total',
      staleTaskStats.lastFailedCount,
      {},
      'Number of stale tasks failed by the most recent detector run.',
    );
    this.prometheusMetricsService.setGauge(
      'noderax_stale_tasks_failed_total',
      staleTaskStats.totalFailedCount,
      {},
      'Total stale tasks failed since process start.',
    );
    this.prometheusMetricsService.setGauge(
      'noderax_rollout_targets_total',
      rolloutHealth.activeTargetCount,
      { outcome: 'active' },
      'Active rollout target count.',
    );
    this.prometheusMetricsService.setGauge(
      'noderax_rollout_targets_total',
      rolloutHealth.failedTargetCount,
      { outcome: 'failed' },
      'Failed rollout target count.',
    );
    this.prometheusMetricsService.setGauge(
      'noderax_outbox_backlog_total',
      outboxSnapshot.backlogCount,
      { status: 'backlog' },
      'Outbox backlog size across pending, failed, and processing records.',
    );
    this.prometheusMetricsService.setGauge(
      'noderax_outbox_due_total',
      outboxSnapshot.dueCount,
      { status: 'due' },
      'Outbox entries due for dispatch.',
    );
    this.prometheusMetricsService.setGauge(
      'noderax_outbox_dead_letter_total',
      outboxSnapshot.deadLetterCount,
      { status: 'dead_letter' },
      'Outbox entries that exhausted retries.',
    );

    for (const snapshot of this.clusterLockService?.getSnapshots() ?? []) {
      this.prometheusMetricsService.setGauge(
        'noderax_cluster_lock_acquisitions_total',
        snapshot.acquisitions,
        { lock_name: snapshot.lockName },
        'Cluster advisory lock acquisition count.',
      );
      this.prometheusMetricsService.setGauge(
        'noderax_cluster_lock_skips_total',
        snapshot.skips,
        { lock_name: snapshot.lockName },
        'Cluster advisory lock skip count.',
      );
    }

    return this.prometheusMetricsService.renderPrometheus();
  }

  private async buildDependencyChecks() {
    const installStateHealth = getInstallStateHealth();
    const databaseReady = await this.checkDatabase();
    const redisReady = await this.checkRedis();
    const migrationsReady = await this.checkMigrations();
    const clusterLockReady = this.checkClusterLocks();
    const outboxReady = await this.checkOutbox();

    return {
      database: databaseReady,
      redis: redisReady,
      installState: installStateHealth.writable
        ? {
            healthy: true,
            status: 'ready',
            detail: installStateHealth.path,
          }
        : {
            healthy: false,
            status: 'unwritable',
            detail: installStateHealth.error,
          },
      migrations: migrationsReady,
      clusterLocks: clusterLockReady,
      outbox: outboxReady,
    };
  }

  private async checkDatabase() {
    try {
      if (!this.dataSource?.isInitialized) {
        return {
          healthy: false,
          status: 'not_initialized',
          detail: 'TypeORM datasource is not initialized.',
        };
      }

      await this.dataSource.query('SELECT 1');
      return {
        healthy: true,
        status: 'ready',
        detail: null,
      };
    } catch (error) {
      return {
        healthy: false,
        status: 'error',
        detail: (error as Error).message,
      };
    }
  }

  private async checkRedis() {
    if (!this.redisService) {
      return {
        healthy: true,
        status: 'disabled',
        detail: 'Redis is not loaded in setup mode.',
      };
    }

    if (!this.redisService.isEnabled()) {
      return {
        healthy: true,
        status: 'disabled',
        detail: 'Redis integration is disabled.',
      };
    }

    const reachable = await this.redisService.ping();
    const snapshot = this.redisService.getHealthSnapshot();
    return reachable
      ? {
          healthy: true,
          status: snapshot.status,
          detail: `subscriber=${snapshot.subscriberStatus}`,
        }
      : {
          healthy: false,
          status: snapshot.status,
          detail: `subscriber=${snapshot.subscriberStatus}`,
        };
  }

  private async checkMigrations() {
    try {
      if (!this.dataSource?.isInitialized) {
        return {
          healthy: false,
          status: 'not_initialized',
          detail: 'Datasource is unavailable for migration checks.',
        };
      }

      const hasPendingMigrations = await this.dataSource.showMigrations();
      return hasPendingMigrations
        ? {
            healthy: false,
            status: 'pending',
            detail: 'Database has pending migrations.',
          }
        : {
            healthy: true,
            status: 'ready',
            detail: null,
          };
    } catch (error) {
      return {
        healthy: false,
        status: 'error',
        detail: (error as Error).message,
      };
    }
  }

  private checkClusterLocks() {
    if (!this.clusterLockService) {
      return {
        healthy: true,
        status: 'disabled',
        detail: 'Cluster locks are inactive in setup mode.',
      };
    }

    const snapshots = this.clusterLockService.getSnapshots();
    const detail = snapshots.length
      ? snapshots
          .map(
            (snapshot) =>
              `${snapshot.lockName}:acquired=${snapshot.acquisitions},skipped=${snapshot.skips}`,
          )
          .join('; ')
      : `instance=${this.clusterLockService.getInstanceId()}`;

    return {
      healthy: true,
      status: 'ready',
      detail,
    };
  }

  private async checkOutbox() {
    if (!this.outboxService) {
      return {
        healthy: true,
        status: 'disabled',
        detail: 'Outbox is inactive in setup mode.',
      };
    }

    const snapshot = await this.outboxService.getOperationalSnapshot();
    const meta = {
      backlogCount: snapshot.backlogCount,
      dueCount: snapshot.dueCount,
      failedCount: snapshot.failedCount,
      deadLetterCount: snapshot.deadLetterCount,
      deadLetters: snapshot.deadLetters,
      actions:
        snapshot.deadLetterCount > 0
          ? [
              { id: 'requeue', label: 'Requeue failed events' },
              { id: 'delete', label: 'Delete dead-letter events' },
            ]
          : [],
    };

    if (snapshot.deadLetterCount > 0) {
      return {
        healthy: false,
        status: 'dead_letter',
        detail: `deadLetter=${snapshot.deadLetterCount}`,
        meta,
      };
    }

    if (snapshot.failedCount > 0 || snapshot.dueCount > 0) {
      return {
        healthy: true,
        status: 'degraded',
        detail: `backlog=${snapshot.backlogCount};due=${snapshot.dueCount};failed=${snapshot.failedCount}`,
        meta,
      };
    }

    return {
      healthy: true,
      status: 'ready',
      detail: `backlog=${snapshot.backlogCount}`,
      meta,
    };
  }
}
