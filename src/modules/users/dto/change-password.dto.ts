import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({
    minLength: 8,
    example: 'CurrentPassword123!',
  })
  @IsString()
  @MinLength(8)
  currentPassword: string;

  @ApiProperty({
    minLength: 8,
    example: 'NewPassword123!',
  })
  @IsString()
  @MinLength(8)
  newPassword: string;
}
