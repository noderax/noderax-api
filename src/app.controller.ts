import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
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
}
