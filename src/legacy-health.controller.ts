import { Controller, Get } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from './common/decorators/public.decorator';
import { AppService } from './app.service';

@ApiExcludeController()
@Controller('api/v1')
export class LegacyHealthController {
  constructor(private readonly appService: AppService) {}

  @Public()
  @Get('health')
  getHealth() {
    return this.appService.getHealth();
  }
}
