import { Transform } from 'class-transformer';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class CreateNodeDto {
  @IsOptional()
  @Transform(({ value }) => value?.trim())
  @IsString()
  @MinLength(2)
  name?: string;

  @Transform(({ value }) => value?.trim().toLowerCase())
  @IsString()
  @MinLength(2)
  hostname: string;

  @Transform(({ value }) => value?.trim())
  @IsString()
  @MinLength(2)
  os: string;

  @Transform(({ value }) => value?.trim())
  @IsString()
  @MinLength(2)
  arch: string;
}
