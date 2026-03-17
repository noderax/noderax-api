import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { clampInteger } from '../../../common/utils/clamp-integer.util';
import { EventSeverity } from '../entities/event-severity.enum';

export class QueryEventsDto {
  @ApiPropertyOptional({
    format: 'uuid',
    example: 'b7f88611-b63e-4c95-9f37-4afb5c0cf275',
  })
  @IsOptional()
  @IsUUID()
  nodeId?: string;

  @ApiPropertyOptional({
    example: 'high.cpu',
  })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional({
    enum: EventSeverity,
    enumName: 'EventSeverity',
    example: EventSeverity.WARNING,
  })
  @IsOptional()
  @IsEnum(EventSeverity)
  severity?: EventSeverity;

  @ApiPropertyOptional({
    example: 50,
    minimum: 1,
    maximum: 100,
    default: 50,
  })
  @IsOptional()
  @Transform(({ value }) => clampInteger(value, { min: 1, max: 100 }))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
