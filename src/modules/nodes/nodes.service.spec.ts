import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
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

  it('allows operational root while desired profile is pending sync', () => {
    const node = buildNode({
      rootAccessAppliedProfile: NodeRootAccessProfile.OFF,
      rootAccessProfile: NodeRootAccessProfile.OPERATIONAL,
      rootAccessSyncStatus: NodeRootAccessSyncStatus.PENDING,
    });

    expect(() => service.assertNodeAllowsOperationalRoot(node)).not.toThrow();
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

  it('allows operational root for legacy helper-missing failed state', () => {
    const node = buildNode({
      rootAccessAppliedProfile: NodeRootAccessProfile.OFF,
      rootAccessProfile: NodeRootAccessProfile.ALL,
      rootAccessSyncStatus: NodeRootAccessSyncStatus.FAILED,
      rootAccessLastError: 'root profile helper is not installed',
    });

    expect(() => service.assertNodeAllowsOperationalRoot(node)).not.toThrow();
  });
});
