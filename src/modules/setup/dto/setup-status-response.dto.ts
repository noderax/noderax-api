import { ApiProperty } from '@nestjs/swagger';

export class SetupStatusResponseDto {
  @ApiProperty({
    enum: ['setup', 'restart_required', 'installed', 'legacy'],
    example: 'setup',
  })
  mode: 'setup' | 'restart_required' | 'installed' | 'legacy';

  @ApiProperty({
    example: false,
  })
  installed: boolean;

  @ApiProperty({
    example: false,
  })
  restartRequired: boolean;
}
