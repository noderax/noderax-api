import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class CreateTeamDto {
  @ApiProperty({
    example: 'Platform Ops',
  })
  @IsString()
  @MinLength(2)
  name: string;

  @ApiPropertyOptional({
    example: 'Handles infra operations and runtime maintenance.',
  })
  @IsOptional()
  @IsString()
  description?: string;
}
