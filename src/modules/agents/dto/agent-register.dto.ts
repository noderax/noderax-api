import { Transform } from 'class-transformer';
import { IsString, MinLength } from 'class-validator';

export class AgentRegisterDto {
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
