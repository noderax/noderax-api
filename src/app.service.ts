import { Injectable } from '@nestjs/common';
import { HealthResponseDto } from './common/dto/health-response.dto';

@Injectable()
export class AppService {
  getHealth(): HealthResponseDto {
    return {
      service: 'noderax-api',
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
}
