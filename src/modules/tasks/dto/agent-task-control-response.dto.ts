import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TaskStatus } from '../entities/task-status.enum';

export class AgentTaskControlResponseDto {
  @ApiProperty({
    format: 'uuid',
    example: 'ec9f97f2-7b56-4a7e-a7cb-5c957e9d32d8',
  })
  taskId: string;

  @ApiProperty({
    enum: TaskStatus,
    enumName: 'TaskStatus',
    example: TaskStatus.RUNNING,
  })
  status: TaskStatus;

  @ApiProperty({
    example: true,
    description:
      'When true, running agent should terminate current execution and report cancelled completion.',
  })
  cancelRequested: boolean;

  @ApiPropertyOptional({
    format: 'date-time',
    nullable: true,
    example: '2026-03-23T10:12:00.000Z',
  })
  cancelRequestedAt: string | null;

  @ApiPropertyOptional({
    nullable: true,
    example: 'Stopped by operator from dashboard',
  })
  cancelReason: string | null;
}
