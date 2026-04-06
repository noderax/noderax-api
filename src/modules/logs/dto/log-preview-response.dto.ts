import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TaskStatus } from '../../tasks/entities/task-status.enum';

class LogPreviewEntryDto {
  @ApiPropertyOptional({
    format: 'date-time',
    nullable: true,
  })
  timestamp?: string | null;

  @ApiProperty({
    example:
      'Failed password for invalid user deploy from 10.0.0.12 port 53412 ssh2',
  })
  message: string;

  @ApiPropertyOptional({
    nullable: true,
  })
  unit?: string | null;

  @ApiPropertyOptional({
    nullable: true,
  })
  identifier?: string | null;
}

export class LogPreviewResponseDto {
  @ApiProperty({
    format: 'uuid',
  })
  taskId: string;

  @ApiProperty({
    enum: TaskStatus,
    enumName: 'TaskStatus',
  })
  taskStatus: TaskStatus;

  @ApiProperty({
    example: 'auth.log',
  })
  sourcePresetId: string;

  @ApiProperty({
    type: () => LogPreviewEntryDto,
    isArray: true,
  })
  entries: LogPreviewEntryDto[];

  @ApiProperty({
    example: false,
  })
  truncated: boolean;

  @ApiProperty({
    type: [String],
  })
  warnings: string[];

  @ApiPropertyOptional({
    nullable: true,
  })
  error: string | null;
}
