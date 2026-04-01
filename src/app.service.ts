import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { HealthResponseDto } from './common/dto/health-response.dto';

@Injectable()
export class AppService {
  private readonly startedAt = new Date().toISOString();
  private readonly bootId = randomUUID();

  getHealth(): HealthResponseDto {
    return {
      service: 'noderax-api',
      status: 'ok',
      timestamp: new Date().toISOString(),
      startedAt: this.startedAt,
      bootId: this.bootId,
    };
  }
}
