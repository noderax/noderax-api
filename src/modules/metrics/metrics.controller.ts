import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { AgentMetricsDto } from './dto/agent-metrics.dto';
import { QueryMetricsDto } from './dto/query-metrics.dto';
import { MetricEntity } from './entities/metric.entity';
import { MetricsService } from './metrics.service';

@ApiTags('Metrics')
@Controller()
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Public()
  @Post('agent/metrics')
  @ApiOperation({
    summary: 'Ingest node metrics',
    description:
      'Stores CPU, memory, disk, and network metrics sent by an authenticated agent.',
  })
  @ApiBody({ type: AgentMetricsDto })
  @ApiOkResponse({
    description: 'Metric successfully stored.',
    type: MetricEntity,
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid node ID or agent token.',
  })
  ingest(@Body() agentMetricsDto: AgentMetricsDto) {
    return this.metricsService.ingest(agentMetricsDto);
  }

  @Get('metrics')
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'List ingested metrics',
  })
  @ApiOkResponse({
    description: 'List of metric samples.',
    type: MetricEntity,
    isArray: true,
  })
  @ApiUnauthorizedResponse({
    description: 'JWT authentication required.',
  })
  findAll(@Query() query: QueryMetricsDto) {
    return this.metricsService.findAll(query);
  }
}
