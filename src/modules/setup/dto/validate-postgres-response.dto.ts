import { ApiProperty } from '@nestjs/swagger';

export class ValidatePostgresResponseDto {
  @ApiProperty({
    example: true,
  })
  success: true;

  @ApiProperty({
    example: 'PostgreSQL 16.0',
  })
  serverVersion: string;

  @ApiProperty({
    example: true,
  })
  databaseEmpty: boolean;
}
