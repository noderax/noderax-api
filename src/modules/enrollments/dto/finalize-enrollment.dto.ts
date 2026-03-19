import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class FinalizeEnrollmentDto {
  @ApiProperty({
    example: 'admin@example.com',
  })
  @Transform(({ value }) => value?.trim().toLowerCase())
  @IsEmail()
  email: string;

  @ApiProperty({
    example: 'Production Node EU-1',
  })
  @Transform(({ value }) => value?.trim())
  @IsString()
  @MinLength(2)
  nodeName: string;

  @ApiPropertyOptional({
    example: 'Primary web node in eu-central-1',
    nullable: true,
  })
  @IsOptional()
  @Transform(({ value }) => value?.trim())
  @IsString()
  @MinLength(2)
  description?: string;
}
