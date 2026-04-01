import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class CreateNodeInstallDto {
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

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    example: 'd9f0f85a-b86f-4e7b-a917-6a3f61b44c2b',
  })
  @IsOptional()
  @Transform(({ value }) => value?.trim())
  @IsUUID()
  teamId?: string;
}
