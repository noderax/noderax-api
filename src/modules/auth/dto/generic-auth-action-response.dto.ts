import { ApiProperty } from '@nestjs/swagger';

export class GenericAuthActionResponseDto {
  @ApiProperty({
    example: true,
  })
  success: true;
}
