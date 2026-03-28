import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateUserPreferencesDto {
  @ApiPropertyOptional({
    example: 'Europe/Istanbul',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  timezone?: string;

  @ApiPropertyOptional({
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  criticalEventEmailsEnabled?: boolean;

  @ApiPropertyOptional({
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  enrollmentEmailsEnabled?: boolean;
}
