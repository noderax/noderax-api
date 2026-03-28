import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const normalizeScopes = ({ value }: { value: unknown }) => {
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split(/[,\s]+/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return ['openid', 'email', 'profile'];
};

export class CreateOidcProviderDto {
  @ApiProperty({ example: 'google' })
  @Transform(({ value }) => value?.trim().toLowerCase())
  @IsString()
  @MinLength(2)
  slug: string;

  @ApiProperty({ example: 'Google Workspace' })
  @Transform(({ value }) => value?.trim())
  @IsString()
  @MinLength(2)
  name: string;

  @ApiPropertyOptional({
    example: 'google',
    nullable: true,
    enum: ['google', 'microsoft'],
  })
  @IsOptional()
  @IsIn(['google', 'microsoft'])
  preset?: 'google' | 'microsoft';

  @ApiProperty({
    example: 'https://accounts.google.com',
  })
  @Transform(({ value }) => value?.trim())
  @IsString()
  @IsUrl({
    require_tld: true,
    require_protocol: true,
  })
  issuer: string;

  @ApiProperty({
    example: 'client-id',
  })
  @Transform(({ value }) => value?.trim())
  @IsString()
  @MinLength(3)
  clientId: string;

  @ApiPropertyOptional({
    example: 'client-secret',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  clientSecret?: string;

  @ApiProperty({
    example: 'https://accounts.google.com/.well-known/openid-configuration',
  })
  @Transform(({ value }) => value?.trim())
  @IsString()
  @IsUrl({
    require_tld: true,
    require_protocol: true,
  })
  discoveryUrl: string;

  @ApiPropertyOptional({
    type: String,
    isArray: true,
    example: ['openid', 'email', 'profile'],
  })
  @IsOptional()
  @Transform(normalizeScopes)
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  scopes?: string[];

  @ApiPropertyOptional({ example: true, default: true })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  enabled?: boolean;
}
