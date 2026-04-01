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

  @ApiProperty({
    example: '2026-03-17T12:00:00.000Z',
    format: 'date-time',
    description: 'Timestamp when the current API process booted.',
  })
  startedAt: string;

  @ApiProperty({
    example: '2e0b7a58-7d0a-4d4a-a909-e246e74f1c6a',
    description: 'Unique identifier for the current API process instance.',
  })
  bootId: string;
}
