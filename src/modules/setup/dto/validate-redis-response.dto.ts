import { ApiProperty } from '@nestjs/swagger';

export class ValidateRedisResponseDto {
  @ApiProperty({
    example: true,
  })
  success: true;
}
