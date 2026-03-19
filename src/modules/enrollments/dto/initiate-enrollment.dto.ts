import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsObject,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class InitiateEnrollmentDto {
  @ApiProperty({
    example: 'admin@example.com',
  })
  @Transform(({ value }) => value?.trim().toLowerCase())
  @IsEmail()
  email: string;

  @ApiProperty({
    example: 'srv-01',
    description: 'Unique hostname reported by the enrolling agent.',
  })
  @Transform(({ value }) => value?.trim().toLowerCase())
  @IsString()
  @MinLength(2)
  hostname: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description:
      'Optional free-form metadata reported by the agent, such as os, arch, platformVersion, kernelVersion, or agentVersion.',
  })
  @IsOptional()
  @IsObject()
  additionalInfo?: Record<string, unknown>;
}
