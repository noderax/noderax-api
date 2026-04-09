import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { legacyOnlyProviders } from '../../install/legacy-bootstrap.utils';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { AuditLogSchemaBootstrap } from './bootstrap/audit-log-schema.bootstrap';
import { AuditLogsController } from './audit-logs.controller';
import { AuditLogsService } from './audit-logs.service';
import { AuditLogEntity } from './entities/audit-log.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([AuditLogEntity]),
    forwardRef(() => WorkspacesModule),
  ],
  controllers: [AuditLogsController],
  providers: [
    AuditLogsService,
    ...legacyOnlyProviders([AuditLogSchemaBootstrap]),
  ],
  exports: [AuditLogsService],
})
export class AuditLogsModule {}
