import { ApiProperty } from '@nestjs/swagger';

export class InstallSetupResponseDto {
  @ApiProperty({
    example: true,
  })
  success: true;

  @ApiProperty({
    example: false,
  })
  restartRequired: boolean;

  @ApiProperty({
    example: true,
  })
  setupComplete: boolean;

  @ApiProperty({
    enum: ['promoting_runtime'],
    example: 'promoting_runtime',
  })
  transition: 'promoting_runtime';
}
