import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PackageSearchResultDto {
  @ApiProperty({
    example: 'nginx',
  })
  name: string;

  @ApiPropertyOptional({
    example: '1.24.0-2ubuntu7',
    nullable: true,
  })
  version: string | null;

  @ApiPropertyOptional({
    example: 'small, powerful, scalable web/proxy server',
    nullable: true,
  })
  description: string | null;
}
