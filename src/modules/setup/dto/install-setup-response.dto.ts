import { ApiProperty } from '@nestjs/swagger';

export class InstallSetupResponseDto {
  @ApiProperty({
    example: true,
  })
  success: true;

  @ApiProperty({
    example: true,
  })
  restartRequired: true;
}
