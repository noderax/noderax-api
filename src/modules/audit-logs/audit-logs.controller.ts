import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { SWAGGER_BEARER_AUTH_NAME } from '../../common/constants/swagger.constants';
import { Roles } from '../../common/decorators/roles.decorator';
import { WorkspaceRoles } from '../../common/decorators/workspace-roles.decorator';
import { WorkspaceMembershipGuard } from '../../common/guards/workspace-membership.guard';
import { WorkspaceRolesGuard } from '../../common/guards/workspace-roles.guard';
import { UserRole } from '../users/entities/user-role.enum';
import { WorkspaceMembershipRole } from '../workspaces/entities/workspace-membership-role.enum';
import { QueryAuditLogsDto } from './dto/query-audit-logs.dto';
import { AuditLogEntity } from './entities/audit-log.entity';
import { AuditLogsService } from './audit-logs.service';

@ApiTags('Audit Logs')
@ApiBearerAuth(SWAGGER_BEARER_AUTH_NAME)
@ApiUnauthorizedResponse({
  description: 'JWT authentication required.',
})
@Controller()
export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  @Get('audit-logs')
  @Roles(UserRole.PLATFORM_ADMIN)
  @ApiOkResponse({
    type: AuditLogEntity,
    isArray: true,
  })
  findPlatformLogs(@Query() query: QueryAuditLogsDto) {
    return this.auditLogsService.findAll(query);
  }

  @Get('workspaces/:workspaceId/audit-logs')
  @UseGuards(WorkspaceMembershipGuard, WorkspaceRolesGuard)
  @WorkspaceRoles(WorkspaceMembershipRole.OWNER, WorkspaceMembershipRole.ADMIN)
  @ApiOkResponse({
    type: AuditLogEntity,
    isArray: true,
  })
  findWorkspaceLogs(
    @Param('workspaceId') workspaceId: string,
    @Query() query: QueryAuditLogsDto,
  ) {
    return this.auditLogsService.findAll(query, workspaceId);
  }
}
