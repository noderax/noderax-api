import { Transform, Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { clampInteger } from '../../../common/utils/clamp-integer.util';
import { EventSeverity } from '../../events/entities/event-severity.enum';
import {
  INCIDENT_STATUSES,
  type IncidentStatus,
} from '../entities/incident-status.enum';

export class QueryIncidentsDto {
  @ApiPropertyOptional({
    enum: INCIDENT_STATUSES,
    example: 'open',
  })
  @IsOptional()
  @IsIn(INCIDENT_STATUSES)
  status?: IncidentStatus;

  @ApiPropertyOptional({
    enum: EventSeverity,
    enumName: 'EventSeverity',
    example: EventSeverity.WARNING,
  })
  @IsOptional()
  @IsEnum(EventSeverity)
  severity?: EventSeverity;

  @ApiPropertyOptional({
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  nodeId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  ruleId?: string;

  @ApiPropertyOptional({
    example: 'auth.log',
  })
  @IsOptional()
  @IsString()
  sourcePresetId?: string;

  @ApiPropertyOptional({
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

  @ApiPropertyOptional({
    minimum: 0,
    default: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
