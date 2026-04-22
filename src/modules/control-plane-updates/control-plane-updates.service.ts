import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { RequestAuditContext } from '../../common/types/request-audit-context.type';
import {
  clearPlatformUpdateRequestState,
  clearPlatformUpdateState,
  type PlatformReleaseState,
  readInstallTransitionState,
  readPlatformUpdateRequestState,
  readPlatformUpdateState,
  readInstallState,
  writePlatformUpdateRequestState,
  writePlatformUpdateState,
} from '../../install/install-state';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AgentUpdatesService } from '../agent-updates/agent-updates.service';
import {
  type ControlPlaneReleaseDto,
  type ControlPlaneUpdateOperationDto,
  ControlPlaneUpdateSummaryDto,
} from './dto/control-plane-update.dto';
import { ControlPlaneReleaseCatalogService } from './control-plane-release-catalog.service';

@Injectable()
export class ControlPlaneUpdatesService {
  private readonly logger = new Logger(ControlPlaneUpdatesService.name);
  private readonly staleApplyTimeoutMs = 15 * 60 * 1000;

  constructor(
    private readonly releaseCatalogService: ControlPlaneReleaseCatalogService,
    private readonly agentUpdatesService: AgentUpdatesService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async getSummary(
    forceRefresh = false,
  ): Promise<ControlPlaneUpdateSummaryDto> {
    const deploymentMode = this.getDeploymentMode();
    const supported = deploymentMode === 'installer_managed';
    const currentRelease = this.readCurrentRelease();
    const noOpReconciledState = this.reconcileStaleNoopApplyState(
      currentRelease,
      this.safeReadPlatformUpdateState(),
      this.safeReadPlatformUpdateRequest(),
    );
    const staleApplyReconciledState = this.reconcileStaleActiveApplyState(
      currentRelease,
      noOpReconciledState.state,
      noOpReconciledState.request,
    );
    const request = staleApplyReconciledState.request;
    const state = staleApplyReconciledState.state;
    const { release: latestRelease, checkedAt } =
      await this.releaseCatalogService.getLatestRelease(forceRefresh);

    const rawPreparedRelease = state?.preparedRelease
      ? this.toReleaseDto(state.preparedRelease)
      : null;
    const preparedRelease =
      rawPreparedRelease?.releaseId &&
      rawPreparedRelease.releaseId === currentRelease?.releaseId
        ? null
        : rawPreparedRelease;
    const latestReleaseId = latestRelease?.releaseId ?? null;
    const currentReleaseId = currentRelease?.releaseId ?? null;
    const preparedReleaseId = preparedRelease?.releaseId ?? null;

    const updateAvailable = Boolean(
      supported &&
      latestReleaseId &&
      latestReleaseId !== currentReleaseId &&
      latestReleaseId !== preparedReleaseId,
    );
    const operation = this.toOperationDto(
      state,
      request,
      currentReleaseId,
      preparedReleaseId,
    );

    const [
      hydratedCurrentRelease,
      hydratedLatestRelease,
      hydratedPreparedRelease,
    ] = await Promise.all([
      this.releaseCatalogService.hydrateRelease(currentRelease),
      this.releaseCatalogService.hydrateRelease(latestRelease),
      this.releaseCatalogService.hydrateRelease(preparedRelease),
    ]);

    return {
      supported,
      deploymentMode,
      currentRelease: hydratedCurrentRelease,
      latestRelease: hydratedLatestRelease,
      preparedRelease: hydratedPreparedRelease,
      updateAvailable,
      operation,
      releaseCheckedAt: checkedAt?.toISOString() ?? null,
    };
  }

  async queueDownload(context: RequestAuditContext) {
    const summary = await this.getSummary(true);
    this.assertSupported(summary.supported);
    this.assertNoConcurrentOperation(summary.operation);

    if (!summary.latestRelease) {
      throw new ConflictException(
        'The official control-plane release feed is currently unavailable.',
      );
    }

    if (
      summary.preparedRelease?.releaseId === summary.latestRelease.releaseId
    ) {
      throw new ConflictException(
        `Control-plane release ${summary.latestRelease.version} is already prepared.`,
      );
    }

    if (summary.currentRelease?.releaseId === summary.latestRelease.releaseId) {
      throw new ConflictException(
        `Control-plane release ${summary.latestRelease.version} is already installed.`,
      );
    }

    const requestedAt = new Date().toISOString();
    const requestId = randomUUID();
    const currentReleaseState = this.toReleaseState(summary.currentRelease);
    const targetReleaseState = this.toReleaseState(summary.latestRelease);

    writePlatformUpdateState({
      operation: 'download',
      status: 'queued',
      requestedAt,
      startedAt: null,
      completedAt: null,
      requestedByUserId: context.actorUserId ?? null,
      requestedByEmailSnapshot: context.actorEmailSnapshot ?? null,
      currentRelease: currentReleaseState,
      targetRelease: targetReleaseState,
      preparedRelease: summary.preparedRelease
        ? this.toReleaseState(summary.preparedRelease)
        : null,
      previousRelease: currentReleaseState,
      message: `Queued latest control-plane download for ${summary.latestRelease.version}.`,
      error: null,
      rollbackStatus: null,
      auditLoggedAt: null,
    });

    writePlatformUpdateRequestState({
      requestId,
      operation: 'download',
      requestedAt,
      requestedByUserId: context.actorUserId ?? null,
      requestedByEmailSnapshot: context.actorEmailSnapshot ?? null,
      targetReleaseId: summary.latestRelease.releaseId,
    });

    await this.auditLogsService.record({
      scope: 'platform',
      action: 'control_plane_update.download.requested',
      targetType: 'control_plane_update',
      targetId: summary.latestRelease.releaseId,
      targetLabel: summary.latestRelease.version,
      metadata: {
        releaseId: summary.latestRelease.releaseId,
        version: summary.latestRelease.version,
      },
      context,
    });

    return this.getSummary(true);
  }

  async queueApply(context: RequestAuditContext) {
    const summary = await this.getSummary();
    this.assertSupported(summary.supported);
    this.assertNoConcurrentOperation(summary.operation);

    if (!summary.preparedRelease) {
      throw new ConflictException(
        'Download the latest control-plane release before applying it.',
      );
    }

    if (
      summary.currentRelease?.releaseId &&
      summary.currentRelease.releaseId === summary.preparedRelease.releaseId
    ) {
      throw new ConflictException(
        `Control-plane release ${summary.preparedRelease.version} is already installed.`,
      );
    }

    if (readInstallTransitionState()) {
      throw new ConflictException(
        'Runtime promotion is still in progress. Wait for setup-to-runtime promotion to finish before applying a control-plane update.',
      );
    }

    const activeRollout = await this.agentUpdatesService.findActiveRollout();
    if (activeRollout) {
      throw new ConflictException(
        `Agent rollout ${activeRollout.targetVersion} is still active. Finish or cancel the rollout before applying a control-plane update.`,
      );
    }

    const requestedAt = new Date().toISOString();
    const requestId = randomUUID();
    const currentReleaseState = this.toReleaseState(summary.currentRelease);
    const targetReleaseState = this.toReleaseState(summary.preparedRelease);

    writePlatformUpdateState({
      operation: 'apply',
      status: 'queued',
      requestedAt,
      startedAt: null,
      completedAt: null,
      requestedByUserId: context.actorUserId ?? null,
      requestedByEmailSnapshot: context.actorEmailSnapshot ?? null,
      currentRelease: currentReleaseState,
      targetRelease: targetReleaseState,
      preparedRelease: targetReleaseState,
      previousRelease: currentReleaseState,
      message: `Queued apply for control-plane release ${summary.preparedRelease.version}.`,
      error: null,
      rollbackStatus: null,
      auditLoggedAt: null,
    });

    writePlatformUpdateRequestState({
      requestId,
      operation: 'apply',
      requestedAt,
      requestedByUserId: context.actorUserId ?? null,
      requestedByEmailSnapshot: context.actorEmailSnapshot ?? null,
      targetReleaseId: summary.preparedRelease.releaseId,
    });

    await this.auditLogsService.record({
      scope: 'platform',
      action: 'control_plane_update.apply.requested',
      targetType: 'control_plane_update',
      targetId: summary.preparedRelease.releaseId,
      targetLabel: summary.preparedRelease.version,
      metadata: {
        releaseId: summary.preparedRelease.releaseId,
        version: summary.preparedRelease.version,
      },
      context,
    });

    return this.getSummary();
  }

  async reconcileTerminalAuditState(): Promise<boolean> {
    const state = this.safeReadPlatformUpdateState();
    if (!state || state.auditLoggedAt) {
      return false;
    }

    if (state.status !== 'completed' && state.status !== 'failed') {
      return false;
    }

    const action =
      state.status === 'completed'
        ? 'control_plane_update.completed'
        : 'control_plane_update.failed';

    await this.auditLogsService.record({
      scope: 'platform',
      action,
      targetType: 'control_plane_update',
      targetId: state.targetRelease?.releaseId ?? null,
      targetLabel: state.targetRelease?.version ?? null,
      metadata: {
        operation: state.operation,
        status: state.status,
        message: state.message,
        error: state.error,
        rollbackStatus: state.rollbackStatus,
        currentReleaseId: state.currentRelease?.releaseId ?? null,
        targetReleaseId: state.targetRelease?.releaseId ?? null,
      },
      context: {
        actorType:
          state.requestedByUserId || state.requestedByEmailSnapshot
            ? 'user'
            : 'system',
        actorUserId: state.requestedByUserId ?? null,
        actorEmailSnapshot: state.requestedByEmailSnapshot ?? null,
      },
    });

    writePlatformUpdateState({
      operation: state.operation,
      status: state.status,
      requestedAt: state.requestedAt,
      startedAt: state.startedAt,
      completedAt: state.completedAt,
      requestedByUserId: state.requestedByUserId,
      requestedByEmailSnapshot: state.requestedByEmailSnapshot,
      currentRelease: state.currentRelease,
      targetRelease: state.targetRelease,
      preparedRelease: state.preparedRelease,
      previousRelease: state.previousRelease,
      message: state.message,
      error: state.error,
      rollbackStatus: state.rollbackStatus,
      auditLoggedAt: new Date().toISOString(),
    });

    return true;
  }

  private getDeploymentMode(): string | null {
    if (process.env.NODERAX_PLATFORM_DEPLOYMENT_MODE?.trim()) {
      return process.env.NODERAX_PLATFORM_DEPLOYMENT_MODE.trim();
    }

    return readInstallState() ? 'installer_managed' : null;
  }

  private readCurrentRelease(): ControlPlaneReleaseDto | null {
    const releaseId = this.readProcessString(
      process.env.NODERAX_PLATFORM_RELEASE_ID,
    );
    const version = this.readProcessString(
      process.env.NODERAX_PLATFORM_VERSION,
    );

    if (!releaseId && !version) {
      return null;
    }

    return {
      version: version ?? '1.0.0',
      releaseId: releaseId ?? version ?? 'unknown',
      releasedAt: this.readProcessString(
        process.env.NODERAX_PLATFORM_RELEASED_AT,
      ),
      builtAt: null,
      bundleSha256: this.readProcessString(
        process.env.NODERAX_PLATFORM_BUNDLE_SHA256,
      ),
      bundleUrl: null,
      manifestUrl: null,
    };
  }

  private toOperationDto(
    state: ReturnType<typeof readPlatformUpdateState> | null,
    request: ReturnType<typeof readPlatformUpdateRequestState> | null,
    currentReleaseId?: string | null,
    preparedReleaseId?: string | null,
  ): ControlPlaneUpdateOperationDto | null {
    if (state) {
      if (
        state.status === 'completed' &&
        this.shouldSuppressCompletedOperation({
          operation: state.operation,
          targetReleaseId: state.targetRelease?.releaseId ?? null,
          currentReleaseId: currentReleaseId ?? null,
          preparedReleaseId: preparedReleaseId ?? null,
        })
      ) {
        return null;
      }

      return {
        operation: state.operation,
        status: state.status,
        message: state.message,
        error: state.error,
        requestedAt: state.requestedAt,
        startedAt: state.startedAt,
        completedAt: state.completedAt,
        requestedByEmailSnapshot: state.requestedByEmailSnapshot,
        rollbackStatus: state.rollbackStatus,
        targetReleaseId:
          state.targetRelease?.releaseId ?? request?.targetReleaseId ?? null,
        targetVersion: state.targetRelease?.version ?? null,
      };
    }

    if (!request) {
      return null;
    }

    return {
      operation: request.operation,
      status: 'queued',
      message:
        'Waiting for the host supervisor to start the control-plane update.',
      error: null,
      requestedAt: request.requestedAt,
      startedAt: null,
      completedAt: null,
      requestedByEmailSnapshot: request.requestedByEmailSnapshot,
      rollbackStatus: null,
      targetReleaseId: request.targetReleaseId ?? null,
      targetVersion: null,
    };
  }

  private toReleaseDto(
    release: PlatformReleaseState | ControlPlaneReleaseDto,
  ): ControlPlaneReleaseDto {
    return {
      version: release.version,
      releaseId: release.releaseId,
      releasedAt: release.releasedAt ?? null,
      builtAt: release.builtAt ?? null,
      bundleSha256: release.bundleSha256 ?? null,
      bundleUrl: release.bundleUrl ?? null,
      manifestUrl: release.manifestUrl ?? null,
      changelog: release.changelog ?? null,
    };
  }

  private toReleaseState(
    release: ControlPlaneReleaseDto | null,
  ): PlatformReleaseState | null {
    if (!release) {
      return null;
    }

    return {
      version: release.version,
      releaseId: release.releaseId,
      releasedAt: release.releasedAt ?? null,
      builtAt: release.builtAt ?? null,
      bundleSha256: release.bundleSha256 ?? null,
      bundleUrl: release.bundleUrl ?? null,
      manifestUrl: release.manifestUrl ?? null,
    };
  }

  private reconcileStaleNoopApplyState(
    currentRelease: ControlPlaneReleaseDto | null,
    state: ReturnType<typeof readPlatformUpdateState> | null,
    request: ReturnType<typeof readPlatformUpdateRequestState> | null,
  ) {
    const currentReleaseId = currentRelease?.releaseId ?? null;
    if (!currentReleaseId) {
      return { state, request };
    }

    const requestTargetsInstalledRelease =
      request?.operation === 'apply' &&
      request.targetReleaseId === currentReleaseId;
    const stateIsStaleNoopApply =
      state?.operation === 'apply' &&
      state.status !== 'completed' &&
      state.status !== 'failed' &&
      state.targetRelease?.releaseId === currentReleaseId &&
      state.preparedRelease?.releaseId === currentReleaseId;

    if (!requestTargetsInstalledRelease && !stateIsStaleNoopApply) {
      return { state, request };
    }

    this.logger.warn(
      `Clearing stale control-plane apply state for already-installed release ${currentReleaseId}.`,
    );

    if (requestTargetsInstalledRelease) {
      clearPlatformUpdateRequestState();
    }

    if (stateIsStaleNoopApply) {
      clearPlatformUpdateState();
    }

    return {
      state: stateIsStaleNoopApply ? null : state,
      request: requestTargetsInstalledRelease ? null : request,
    };
  }

  private reconcileStaleActiveApplyState(
    currentRelease: ControlPlaneReleaseDto | null,
    state: ReturnType<typeof readPlatformUpdateState> | null,
    request: ReturnType<typeof readPlatformUpdateRequestState> | null,
  ) {
    if (
      !state ||
      state.operation !== 'apply' ||
      state.status === 'completed' ||
      state.status === 'failed'
    ) {
      return { state, request };
    }

    const startedAtMs = Date.parse(state.startedAt ?? state.requestedAt ?? '');
    if (!Number.isFinite(startedAtMs)) {
      return { state, request };
    }

    if (Date.now() - startedAtMs < this.staleApplyTimeoutMs) {
      return { state, request };
    }

    const completedAt = new Date().toISOString();
    const currentReleaseId = currentRelease?.releaseId ?? null;
    const targetReleaseId =
      state.targetRelease?.releaseId ?? request?.targetReleaseId ?? null;

    if (
      currentReleaseId &&
      targetReleaseId &&
      currentReleaseId === targetReleaseId
    ) {
      this.logger.warn(
        `Completing stale control-plane apply state for already-active release ${currentReleaseId}.`,
      );

      writePlatformUpdateState({
        operation: state.operation,
        status: 'completed',
        requestedAt: state.requestedAt,
        startedAt: state.startedAt,
        completedAt,
        requestedByUserId: state.requestedByUserId,
        requestedByEmailSnapshot: state.requestedByEmailSnapshot,
        currentRelease: state.targetRelease ?? state.currentRelease,
        targetRelease: state.targetRelease,
        preparedRelease: null,
        previousRelease: state.previousRelease,
        message:
          'Control-plane update recovered after the target release was already activated.',
        error: null,
        rollbackStatus: 'not_needed',
        auditLoggedAt: state.auditLoggedAt ?? null,
      });
      clearPlatformUpdateRequestState();

      return {
        state: readPlatformUpdateState(),
        request: null,
      };
    }

    const operatorGuidance = this.buildStaleApplyGuidance(currentReleaseId);
    this.logger.error(
      `Marking stale control-plane apply state as failed after timeout. current=${currentReleaseId ?? 'unknown'} target=${targetReleaseId ?? 'unknown'}`,
    );

    writePlatformUpdateState({
      operation: state.operation,
      status: 'failed',
      requestedAt: state.requestedAt,
      startedAt: state.startedAt,
      completedAt,
      requestedByUserId: state.requestedByUserId,
      requestedByEmailSnapshot: state.requestedByEmailSnapshot,
      currentRelease: currentRelease
        ? this.toReleaseState(currentRelease)
        : state.currentRelease,
      targetRelease: state.targetRelease,
      preparedRelease: state.preparedRelease,
      previousRelease: state.previousRelease,
      message:
        'Control-plane apply timed out before the target release became active.',
      error: operatorGuidance,
      rollbackStatus: state.rollbackStatus ?? null,
      auditLoggedAt: state.auditLoggedAt ?? null,
    });
    clearPlatformUpdateRequestState();

    return {
      state: readPlatformUpdateState(),
      request: null,
    };
  }

  private buildStaleApplyGuidance(currentReleaseId: string | null) {
    const releaseIdLooksTimestamp =
      typeof currentReleaseId === 'string' &&
      /^[0-9]{8}T[0-9]{6}Z$/.test(currentReleaseId);

    if (releaseIdLooksTimestamp && currentReleaseId < '20260416T210639Z') {
      return 'The host-side updater on this control-plane build predates the self-update recovery fix. Refresh control-plane-update.sh and supervisor.sh on the host from the latest bundle, restart the supervisor, then retry the apply.';
    }

    return 'Review the host-side control-plane update state and supervisor logs, then retry the apply once the runtime is stable.';
  }

  private assertSupported(supported: boolean) {
    if (!supported) {
      throw new ConflictException(
        'Control-plane self-update is only available for installer-managed deployments.',
      );
    }
  }

  private assertNoConcurrentOperation(
    operation: ControlPlaneUpdateOperationDto | null,
  ) {
    if (!operation) {
      return;
    }

    if (
      operation.status === 'queued' ||
      operation.status === 'downloading' ||
      operation.status === 'verifying' ||
      operation.status === 'extracting' ||
      operation.status === 'loading_images' ||
      operation.status === 'applying' ||
      operation.status === 'recreating_services'
    ) {
      throw new ConflictException(
        `Control-plane ${operation.operation} is already ${operation.status}. Wait for the current operation to finish before starting another one.`,
      );
    }
  }

  private safeReadPlatformUpdateState() {
    try {
      return readPlatformUpdateState();
    } catch (error) {
      this.logger.warn(
        `Ignoring invalid control-plane update state: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
      return null;
    }
  }

  private safeReadPlatformUpdateRequest() {
    try {
      return readPlatformUpdateRequestState();
    } catch (error) {
      this.logger.warn(
        `Clearing invalid control-plane update request: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
      clearPlatformUpdateRequestState();
      return null;
    }
  }

  private readProcessString(value: string | undefined) {
    return typeof value === 'string' && value.trim().length
      ? value.trim()
      : null;
  }

  private shouldSuppressCompletedOperation(input: {
    operation: 'download' | 'apply';
    targetReleaseId: string | null;
    currentReleaseId: string | null;
    preparedReleaseId: string | null;
  }) {
    if (!input.targetReleaseId) {
      return true;
    }

    if (
      input.operation === 'apply' &&
      input.currentReleaseId === input.targetReleaseId
    ) {
      return true;
    }

    if (
      input.operation === 'download' &&
      input.preparedReleaseId === input.targetReleaseId
    ) {
      return true;
    }

    return false;
  }
}
