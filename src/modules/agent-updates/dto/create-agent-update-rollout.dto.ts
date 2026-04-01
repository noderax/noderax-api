import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

export class CreateAgentUpdateRolloutDto {
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

  @ApiPropertyOptional({
    example: '1.0.1',
    description:
      'Requested official tagged release. When omitted, the latest official tagged release is used.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  version?: string;

  @ApiPropertyOptional({
    example: false,
    description:
      'Marks the rollout as a rollback operation for UI and audit surfaces.',
  })
  @IsOptional()
  @IsBoolean()
  rollback?: boolean;
}
