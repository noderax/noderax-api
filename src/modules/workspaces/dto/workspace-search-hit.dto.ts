import { ApiProperty } from '@nestjs/swagger';

export class WorkspaceSearchHitDto {
  @ApiProperty({
    format: 'uuid',
  })
  id: string;

  @ApiProperty({
    example: 'Daily hostname check',
  })
  title: string;

  @ApiProperty({
    nullable: true,
    example: 'enabled · srv-01',
  })
  subtitle: string | null;
}
