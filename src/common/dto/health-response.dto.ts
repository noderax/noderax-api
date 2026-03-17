import { ApiProperty } from '@nestjs/swagger';

export class HealthResponseDto {
  @ApiProperty({
    example: 'noderax-api',
    description: 'Service identifier.',
  })
  service: string;

  @ApiProperty({
    example: 'ok',
    description: 'Current application health status.',
  })
  status: string;

  @ApiProperty({
    example: '2026-03-17T12:30:00.000Z',
    format: 'date-time',
    description: 'Timestamp when the health response was generated.',
  })
  timestamp: string;
}
