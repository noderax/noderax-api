import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class ConfirmMfaSetupDto {
  @ApiProperty({
    example: '123456',
    description: 'Current authenticator app code used to confirm enrollment.',
  })
  @IsString()
  @Matches(/^\d{6}$/)
  token: string;
}
