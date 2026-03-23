import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class InstallPackagesDto {
  @ApiProperty({
    type: String,
    isArray: true,
    example: ['nginx', 'curl'],
  })
  @Transform(({ value }) =>
    Array.isArray(value)
      ? value.map((entry) => (typeof entry === 'string' ? entry.trim() : entry))
      : value,
  )
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(255, { each: true })
  names: string[];

  @ApiPropertyOptional({
    example: false,
    description:
      'Forwarded to the agent for compatibility with the packageInstall task payload.',
  })
  @IsOptional()
  @IsBoolean()
  purge?: boolean;
}
