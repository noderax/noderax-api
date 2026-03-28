import { ApiProperty } from '@nestjs/swagger';

export class ValidateSmtpResponseDto {
  @ApiProperty({
    example: true,
  })
  success: true;
}
