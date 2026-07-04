import { ApiProperty } from '@nestjs/swagger';

export class DataUsageTableDto {
  @ApiProperty({ example: 'metrics' })
  table: string;

  @ApiProperty({
    description: 'Total on-disk size in bytes (table + indexes + toast).',
    example: 524288000,
  })
  totalBytes: number;

  @ApiProperty({
    description: 'Estimated row count from planner statistics (not exact).',
    example: 1250000,
  })
  estimatedRows: number;
}

export class DataUsageResponseDto {
  @ApiProperty({
    description: 'Total on-disk size of the current database in bytes.',
    example: 1073741824,
  })
  totalDatabaseBytes: number;

  @ApiProperty({
    description:
      'Row counts are estimates from PostgreSQL planner statistics, not exact COUNT(*).',
    example: true,
  })
  rowsAreEstimated: boolean;

  @ApiProperty({ type: [DataUsageTableDto] })
  tables: DataUsageTableDto[];
}
