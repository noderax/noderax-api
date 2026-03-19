import { ApiProperty } from '@nestjs/swagger';

export class InitiateEnrollmentResponseDto {
  @ApiProperty({
    example: 'nrygC4WefXwkwUfYx3Lx4Wq4vL99b2WGdo6Ru8a11ug',
    description:
      'Short-lived enrollment token returned to the agent. The raw token is never stored in the database.',
  })
  token: string;

  @ApiProperty({
    format: 'date-time',
    example: '2026-03-19T14:15:00.000Z',
  })
  expiresAt: Date;
}
