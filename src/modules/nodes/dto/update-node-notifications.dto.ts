import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
} from 'class-validator';
import { EventSeverity } from '../../events/entities/event-severity.enum';

export class UpdateNodeNotificationsDto {
  @ApiPropertyOptional({
    example: true,
    description:
      'Allow or suppress email delivery for node-scoped events when the workspace email channel is enabled.',
  })
  @IsOptional()
  @IsBoolean()
  notificationEmailEnabled?: boolean;

  @ApiPropertyOptional({
    enum: EventSeverity,
    enumName: 'EventSeverity',
    isArray: true,
    example: [
      EventSeverity.INFO,
      EventSeverity.WARNING,
      EventSeverity.CRITICAL,
    ],
    description:
      'Allowed email severities for node-scoped events. Empty means no node-scoped emails are sent even when the email channel is enabled.',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(EventSeverity, { each: true })
  notificationEmailLevels?: EventSeverity[];

  @ApiPropertyOptional({
    example: true,
    description:
      'Allow or suppress Telegram delivery for node-scoped events when the workspace Telegram channel is enabled.',
  })
  @IsOptional()
  @IsBoolean()
  notificationTelegramEnabled?: boolean;

  @ApiPropertyOptional({
    enum: EventSeverity,
    enumName: 'EventSeverity',
    isArray: true,
    example: [EventSeverity.WARNING, EventSeverity.CRITICAL],
    description:
      'Allowed Telegram severities for node-scoped events. Empty means no node-scoped Telegram messages are sent even when the Telegram channel is enabled.',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(EventSeverity, { each: true })
  notificationTelegramLevels?: EventSeverity[];
}
