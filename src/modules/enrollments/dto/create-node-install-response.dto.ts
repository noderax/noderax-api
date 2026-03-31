import { ApiProperty } from '@nestjs/swagger';

export class CreateNodeInstallResponseDto {
  @ApiProperty({
    format: 'uuid',
    example: 'f6f9b1a7-62de-4d53-b37a-c6e1ffefbb6f',
  })
  installId: string;

  @ApiProperty({
    example:
      'curl -fsSL https://cdn.noderax.net/noderax-agent/install.sh | sudo bash -s -- --api-url https://api.noderax.net --bootstrap-token abc123',
  })
  installCommand: string;

  @ApiProperty({
    example: 'https://cdn.noderax.net/noderax-agent/install.sh',
  })
  scriptUrl: string;

  @ApiProperty({
    example: 'https://api.noderax.net',
  })
  apiUrl: string;

  @ApiProperty({
    format: 'date-time',
    example: '2026-03-31T12:49:56.000Z',
  })
  expiresAt: Date;
}
