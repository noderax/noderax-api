import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

export class CreateTeamTaskDto {
  @ApiProperty({
    example: 'shell.exec',
  })
  @IsString()
  @MinLength(2)
  type: string;

  @ApiPropertyOptional({
    example: {
      command: 'hostname',
    },
    type: 'object',
    additionalProperties: true,
  })
  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
  })
  @IsOptional()
  @IsUUID()
  templateId?: string;
}
