import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

export class CreateBatchTaskDto {
  @ApiProperty({
    type: String,
    isArray: true,
    format: 'uuid',
    example: [
      'b7f88611-b63e-4c95-9f37-4afb5c0cf275',
      '8fbf6842-7436-4cf3-9de7-8f04ca93e3f7',
    ],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  nodeIds: string[];

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
}
