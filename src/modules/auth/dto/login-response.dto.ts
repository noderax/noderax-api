import { ApiPropertyOptional } from '@nestjs/swagger';
import { UserResponseDto } from '../../users/dto/user-response.dto';

export class LoginResponseDto {
  @ApiPropertyOptional({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.example',
    description: 'JWT access token for authenticated requests.',
  })
  accessToken?: string;

  @ApiPropertyOptional({
    example: '1d',
    description: 'Configured JWT expiration window.',
  })
  expiresIn?: string;

  @ApiPropertyOptional({
    type: UserResponseDto,
  })
  user?: UserResponseDto;

  @ApiPropertyOptional({
    example: true,
    description:
      'Returned when password validation succeeded but MFA is still required.',
  })
  requiresMfa?: boolean;

  @ApiPropertyOptional({
    example: 'eyJhbGciOiJIUzI1NiJ9.mfa-challenge',
    description: 'Short-lived token used to finish MFA verification.',
  })
  mfaChallengeToken?: string;

  @ApiPropertyOptional({
    example: '/dashboard',
    nullable: true,
  })
  redirectPath?: string | null;
}
