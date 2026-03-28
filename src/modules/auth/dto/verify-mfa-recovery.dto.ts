import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class VerifyMfaRecoveryDto {
  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiJ9.challenge',
  })
  @IsString()
  @MinLength(16)
  challengeToken: string;

  @ApiProperty({
    example: '1A2B3C4D5E',
  })
  @IsString()
  @MinLength(6)
  recoveryCode: string;
}
