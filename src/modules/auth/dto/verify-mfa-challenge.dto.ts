import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MinLength } from 'class-validator';

export class VerifyMfaChallengeDto {
  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiJ9.challenge',
  })
  @IsString()
  @MinLength(16)
  challengeToken: string;

  @ApiProperty({
    example: '123456',
    description: 'Current authenticator app code.',
  })
  @IsString()
  @Matches(/^\d{6}$/)
  token: string;
}
