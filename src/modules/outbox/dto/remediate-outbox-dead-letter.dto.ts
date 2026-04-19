import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsUUID } from 'class-validator';

export class RemediateOutboxDeadLetterDto {
  @ApiProperty({
    type: String,
    isArray: true,
    format: 'uuid',
  })
  @IsArray()
  @IsUUID('4', { each: true })
  ids: string[];
}

export class OutboxDeadLetterRecordDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'event.created' })
  type: string;

  @ApiProperty({ example: 8 })
  attempts: number;

  @ApiProperty({ nullable: true })
  lastError: string | null;

  @ApiProperty({ format: 'date-time' })
  updatedAt: string;
}

export class OutboxDeadLetterListResponseDto {
  @ApiProperty({
    type: () => OutboxDeadLetterRecordDto,
    isArray: true,
  })
  items: OutboxDeadLetterRecordDto[];
}

export class RemediateOutboxDeadLetterResponseDto {
  @ApiProperty({ example: true })
  success: true;

  @ApiProperty({ example: 2 })
  affected: number;
}
