import { Controller, Get } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from './common/decorators/public.decorator';
import { AppService } from './app.service';

@ApiExcludeController()
@Controller()
export class LegacyHealthController {
  constructor(private readonly appService: AppService) {}

  @Public()
  @Get('api/v1/health')
  getHealth() {
    return this.appService.getHealth();
  }
}
