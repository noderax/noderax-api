import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class AcceptInvitationDto {
  @ApiProperty({
    minLength: 8,
    example: 'StrongPassword123!',
  })
  @IsString()
  @MinLength(8)
  password: string;
}
