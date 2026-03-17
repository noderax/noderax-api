import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class CreateNodeDto {
  @ApiPropertyOptional({
    example: 'Production Node EU-1',
    description: 'Optional display name. Defaults to hostname when omitted.',
  })
  @IsOptional()
  @Transform(({ value }) => value?.trim())
  @IsString()
  @MinLength(2)
  name?: string;

  @ApiProperty({
    example: 'srv-01',
    description: 'Unique node hostname.',
  })
  @Transform(({ value }) => value?.trim().toLowerCase())
  @IsString()
  @MinLength(2)
  hostname: string;

  @ApiProperty({
    example: 'ubuntu-24.04',
  })
  @Transform(({ value }) => value?.trim())
  @IsString()
  @MinLength(2)
  os: string;

  @ApiProperty({
    example: 'amd64',
  })
  @Transform(({ value }) => value?.trim())
  @IsString()
  @MinLength(2)
  arch: string;
}
