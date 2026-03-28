import { ApiProperty } from '@nestjs/swagger';

export class PasswordResetPreviewDto {
  @ApiProperty({
    example: 'ops@noderax.local',
  })
  email: string;

  @ApiProperty({
    format: 'date-time',
    example: '2026-03-20T12:30:00.000Z',
  })
  expiresAt: Date;
}
