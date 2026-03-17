import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { AgentMetricsDto } from './dto/agent-metrics.dto';
import { QueryMetricsDto } from './dto/query-metrics.dto';
import { MetricsService } from './metrics.service';

@Controller()
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Public()
  @Post('agent/metrics')
  ingest(@Body() agentMetricsDto: AgentMetricsDto) {
    return this.metricsService.ingest(agentMetricsDto);
  }

  @Get('metrics')
  findAll(@Query() query: QueryMetricsDto) {
    return this.metricsService.findAll(query);
  }
}
