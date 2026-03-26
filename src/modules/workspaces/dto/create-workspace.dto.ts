import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class CreateWorkspaceDto {
  @ApiProperty({
    example: 'Acme Operations',
  })
  @IsString()
  @MinLength(2)
  name: string;

  @ApiProperty({
    example: 'acme-ops',
  })
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message:
      'Slug must use lowercase letters, numbers, and single hyphens only.',
  })
  slug: string;

  @ApiPropertyOptional({
    example: 'Europe/Istanbul',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  defaultTimezone?: string;

  @ApiPropertyOptional({
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  isArchived?: boolean;
}
