import { ApiProperty } from '@nestjs/swagger';

export class ResendUserInviteResponseDto {
  @ApiProperty({
    example: true,
  })
  sent: true;

  @ApiProperty({
    format: 'uuid',
    example: '4d2d2219-5d3e-4761-a79b-3c09ae88d6d3',
  })
  userId: string;

  @ApiProperty({
    format: 'date-time',
    example: '2026-03-20T12:30:00.000Z',
  })
  expiresAt: Date;
}
