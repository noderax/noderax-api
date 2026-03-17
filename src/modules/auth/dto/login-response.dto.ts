import { ApiProperty } from '@nestjs/swagger';
import { UserResponseDto } from '../../users/dto/user-response.dto';

export class LoginResponseDto {
  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.example',
    description: 'JWT access token for authenticated requests.',
  })
  accessToken: string;

  @ApiProperty({
    example: '1d',
    description: 'Configured JWT expiration window.',
  })
  expiresIn: string;

  @ApiProperty({
    type: UserResponseDto,
  })
  user: UserResponseDto;
}
