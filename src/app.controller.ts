import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  DependencyHealthResponseDto,
  ReadinessResponseDto,
} from './common/dto/dependency-health-response.dto';
import { HealthResponseDto } from './common/dto/health-response.dto';
import { Public } from './common/decorators/public.decorator';
import { AppService } from './app.service';

@ApiTags('System')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Public()
  @Get('health')
  @ApiOperation({
    summary: 'Check API health',
    description:
      'Returns a lightweight health payload for uptime and load balancer checks.',
  })
  @ApiOkResponse({
    description: 'Health check response.',
    type: HealthResponseDto,
  })
  getHealth() {
    return this.appService.getHealth();
  }

  @Public()
  @Get('health/ready')
  @ApiOperation({
    summary: 'Check API readiness',
    description:
      'Returns dependency-aware readiness for deploys and active traffic checks.',
  })
  @ApiOkResponse({
    description: 'Readiness check response.',
    type: ReadinessResponseDto,
  })
  getReadiness() {
    return this.appService.getReadiness();
  }

  @Public()
  @Get('health/dependencies')
  @ApiOperation({
    summary: 'Inspect API dependency health',
    description:
      'Returns individual dependency checks for PostgreSQL, Redis, install state, and migrations.',
  })
  @ApiOkResponse({
    description: 'Dependency health response.',
    type: DependencyHealthResponseDto,
  })
  getDependencyHealth() {
    return this.appService.getDependencyHealth();
  }
}
