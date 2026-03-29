import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';
import { EventSeverity } from '../../events/entities/event-severity.enum';

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

  @ApiPropertyOptional({
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  automationEmailEnabled?: boolean;

  @ApiPropertyOptional({
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  automationTelegramEnabled?: boolean;

  @ApiPropertyOptional({
    example: '123456789:ABCDefghIJKLmnopQRSTuvwxyz',
  })
  @IsOptional()
  @IsString()
  automationTelegramBotToken?: string;

  @ApiPropertyOptional({
    example: '-1001234567890',
  })
  @IsOptional()
  @IsString()
  automationTelegramChatId?: string;

  @ApiPropertyOptional({
    example: ['critical', 'warning'],
    enum: EventSeverity,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsEnum(EventSeverity, { each: true })
  automationEmailLevels?: EventSeverity[];

  @ApiPropertyOptional({
    example: ['critical'],
    enum: EventSeverity,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsEnum(EventSeverity, { each: true })
  automationTelegramLevels?: EventSeverity[];
}
