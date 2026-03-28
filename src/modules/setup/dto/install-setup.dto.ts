import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsString,
  Matches,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { MailSettingsDto } from '../../../common/dto/mail-settings.dto';
import { ValidatePostgresConnectionDto } from './validate-postgres-connection.dto';
import { ValidateRedisConnectionDto } from './validate-redis-connection.dto';

class SetupAdminDto {
  @ApiProperty({
    example: 'Noderax Admin',
  })
  @IsString()
  @MinLength(2)
  name: string;

  @ApiProperty({
    example: 'admin@example.com',
  })
  @IsEmail()
  email: string;

  @ApiProperty({
    example: 'ChangeMe123!',
  })
  @IsString()
  @MinLength(8)
  password: string;
}

class SetupWorkspaceDto {
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
  @MinLength(2)
  @Matches(/^[a-z0-9-]+$/)
  slug: string;

  @ApiProperty({
    example: 'Europe/Istanbul',
  })
  @IsString()
  @MinLength(1)
  defaultTimezone: string;
}

export class InstallSetupDto {
  @ApiProperty({
    type: () => ValidatePostgresConnectionDto,
  })
  @ValidateNested()
  @Type(() => ValidatePostgresConnectionDto)
  postgres: ValidatePostgresConnectionDto;

  @ApiProperty({
    type: () => ValidateRedisConnectionDto,
  })
  @ValidateNested()
  @Type(() => ValidateRedisConnectionDto)
  redis: ValidateRedisConnectionDto;

  @ApiProperty({
    type: () => SetupAdminDto,
  })
  @ValidateNested()
  @Type(() => SetupAdminDto)
  admin: SetupAdminDto;

  @ApiProperty({
    type: () => SetupWorkspaceDto,
  })
  @ValidateNested()
  @Type(() => SetupWorkspaceDto)
  workspace: SetupWorkspaceDto;

  @ApiProperty({
    type: () => MailSettingsDto,
  })
  @ValidateNested()
  @Type(() => MailSettingsDto)
  mail: MailSettingsDto;
}
