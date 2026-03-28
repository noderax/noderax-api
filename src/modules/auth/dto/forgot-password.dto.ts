import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';

export class ForgotPasswordDto {
  @ApiProperty({
    example: 'ops@noderax.local',
  })
  @Transform(({ value }) => value?.trim().toLowerCase())
  @IsEmail()
  email: string;
}
