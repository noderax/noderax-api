import { ApiProperty } from '@nestjs/swagger';

export class MfaSetupResponseDto {
  @ApiProperty({
    example: 'JBSWY3DPEHPK3PXP',
  })
  secret: string;

  @ApiProperty({
    example:
      'otpauth://totp/Noderax:admin%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Noderax&algorithm=SHA1&digits=6&period=30',
  })
  otpauthUrl: string;
}
