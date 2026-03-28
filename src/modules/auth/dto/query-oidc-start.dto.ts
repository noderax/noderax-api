import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUrl } from 'class-validator';

export class QueryOidcStartDto {
  @ApiProperty({
    example: 'https://app.noderax.net/api/auth/oidc/google/callback',
  })
  @Transform(({ value }) => value?.trim())
  @IsUrl({
    require_tld: false,
    require_protocol: true,
  })
  redirectUri: string;

  @ApiPropertyOptional({
    example: '/dashboard',
    nullable: true,
  })
  @IsOptional()
  @Transform(({ value }) => value?.trim())
  @IsString()
  next?: string;
}
