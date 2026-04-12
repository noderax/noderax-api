import { Module } from '@nestjs/common';
import { AgentUpdatesModule } from '../agent-updates/agent-updates.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ControlPlaneReleaseCatalogService } from './control-plane-release-catalog.service';
import { ControlPlaneUpdateMonitorService } from './control-plane-update-monitor.service';
import { ControlPlaneUpdatesController } from './control-plane-updates.controller';
import { ControlPlaneUpdatesService } from './control-plane-updates.service';

@Module({
  imports: [AuditLogsModule, AgentUpdatesModule],
  controllers: [ControlPlaneUpdatesController],
  providers: [
    ControlPlaneReleaseCatalogService,
    ControlPlaneUpdatesService,
    ControlPlaneUpdateMonitorService,
  ],
  exports: [ControlPlaneUpdatesService],
})
export class ControlPlaneUpdatesModule {}
