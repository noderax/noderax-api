import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class UpdateUserPreferencesDto {
  @ApiProperty({
    example: 'Europe/Istanbul',
  })
  @IsString()
  @MinLength(1)
  timezone: string;
}
