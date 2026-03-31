import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

class ConsumeNodeInstallAdditionalInfoDto {
  @ApiPropertyOptional({
    example: 'ubuntu-24.04',
  })
  @IsOptional()
  @Transform(({ value }) => value?.trim())
  @IsString()
  @MaxLength(255)
  os?: string;

  @ApiPropertyOptional({
    example: 'amd64',
  })
  @IsOptional()
  @Transform(({ value }) => value?.trim())
  @IsString()
  @MaxLength(64)
  arch?: string;

  @ApiPropertyOptional({
    example: '1.2.3',
  })
  @IsOptional()
  @Transform(({ value }) => value?.trim())
  @IsString()
  @MaxLength(64)
  agentVersion?: string;

  @ApiPropertyOptional({
    example: 'Ubuntu 24.04',
  })
  @IsOptional()
  @Transform(({ value }) => value?.trim())
  @IsString()
  @MaxLength(120)
  platformVersion?: string;

  @ApiPropertyOptional({
    example: '6.8.0',
  })
  @IsOptional()
  @Transform(({ value }) => value?.trim())
  @IsString()
  @MaxLength(120)
  kernelVersion?: string;
}

export class ConsumeNodeInstallDto {
  @ApiProperty({
    example: 'nrygC4WefXwkwUfYx3Lx4Wq4vL99b2WGdo6Ru8a11ug',
  })
  @Transform(({ value }) => value?.trim())
  @IsString()
  @MinLength(8)
  token: string;

  @ApiProperty({
    example: 'srv-prod-01',
  })
  @Transform(({ value }) => value?.trim().toLowerCase())
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  hostname: string;

  @ApiPropertyOptional({
    type: ConsumeNodeInstallAdditionalInfoDto,
  })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ConsumeNodeInstallAdditionalInfoDto)
  additionalInfo?: ConsumeNodeInstallAdditionalInfoDto;
}
