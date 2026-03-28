import { ApiProperty } from '@nestjs/swagger';

export class InvitationPreviewDto {
  @ApiProperty({
    example: 'ops@noderax.local',
  })
  email: string;

  @ApiProperty({
    example: 'Operations User',
  })
  name: string;

  @ApiProperty({
    format: 'date-time',
    example: '2026-03-20T12:30:00.000Z',
  })
  expiresAt: Date;
}
