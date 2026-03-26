import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { SWAGGER_BEARER_AUTH_NAME } from '../../common/constants/swagger.constants';
import { WorkspaceMembershipGuard } from '../../common/guards/workspace-membership.guard';
import { QueryMetricsDto } from './dto/query-metrics.dto';
import { MetricEntity } from './entities/metric.entity';
import { MetricsService } from './metrics.service';

@ApiTags('Workspace Metrics')
@ApiBearerAuth(SWAGGER_BEARER_AUTH_NAME)
@ApiUnauthorizedResponse({
  description: 'JWT authentication required.',
})
@Controller('workspaces/:workspaceId/metrics')
@UseGuards(WorkspaceMembershipGuard)
export class WorkspaceMetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  @ApiOperation({
    summary: 'List metrics in a workspace',
  })
  @ApiOkResponse({
    type: MetricEntity,
    isArray: true,
  })
  findAll(
    @Param('workspaceId') workspaceId: string,
    @Query() query: QueryMetricsDto,
  ) {
    return this.metricsService.findAll(query, workspaceId);
  }
}
