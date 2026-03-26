import { ApiProperty } from '@nestjs/swagger';

class SetupStateDirectoryStatusDto {
  @ApiProperty({
    example: '/data/noderax/install-state.json',
  })
  path: string;

  @ApiProperty({
    example: true,
  })
  usingCustomPath: boolean;

  @ApiProperty({
    example: true,
  })
  writable: boolean;

  @ApiProperty({
    example: null,
    nullable: true,
  })
  error: string | null;
}

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

  @ApiProperty({
    type: SetupStateDirectoryStatusDto,
  })
  stateDirectory: SetupStateDirectoryStatusDto;
}
