import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({
    example: 'admin@noderax.local',
    description: 'User email address.',
  })
  @Transform(({ value }) => value?.trim().toLowerCase())
  @IsEmail()
  email: string;

  @ApiProperty({
    example: 'ChangeMe123!',
    description: 'User password.',
    minLength: 8,
  })
  @IsString()
  @MinLength(8)
  password: string;
}
