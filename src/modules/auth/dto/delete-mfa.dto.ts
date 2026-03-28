import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class DeleteMfaDto {
  @ApiProperty({
    example: '123456',
    description:
      'Current authenticator code required before MFA can be disabled.',
  })
  @IsString()
  @Matches(/^\d{6}$/)
  token: string;
}
