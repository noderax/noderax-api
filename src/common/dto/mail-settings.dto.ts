import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsString,
  IsUrl,
  Max,
  Min,
  MinLength,
} from 'class-validator';

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class MailSettingsDto {
  @ApiProperty({
    example: 'smtp.resend.com',
  })
  @Transform(trimString)
  @IsString()
  smtpHost: string;

  @ApiProperty({
    example: 587,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  smtpPort: number;

  @ApiProperty({
    example: false,
  })
  @Type(() => Boolean)
  @IsBoolean()
  smtpSecure: boolean;

  @ApiProperty({
    example: 'resend',
  })
  @Transform(trimString)
  @IsString()
  smtpUsername: string;

  @ApiProperty({
    example: 're_example',
  })
  @IsString()
  smtpPassword: string;

  @ApiProperty({
    example: 'info@noderax.net',
  })
  @Transform(trimString)
  @IsEmail()
  fromEmail: string;

  @ApiProperty({
    example: 'Noderax Support',
  })
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  fromName: string;

  @ApiProperty({
    example: 'https://app.noderax.net',
  })
  @Transform(trimString)
  @IsUrl({
    require_protocol: true,
    require_tld: false,
  })
  webAppUrl: string;
}
