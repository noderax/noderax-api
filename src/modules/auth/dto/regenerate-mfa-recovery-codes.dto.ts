import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class RegenerateMfaRecoveryCodesDto {
  @ApiProperty({
    example: '123456',
    description:
      'Current authenticator code required before issuing a fresh recovery-code set.',
  })
  @IsString()
  @Matches(/^\d{6}$/)
  token: string;
}
