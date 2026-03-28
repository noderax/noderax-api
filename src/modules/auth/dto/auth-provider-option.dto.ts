import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AuthProviderOptionDto {
  @ApiProperty({ example: 'google' })
  slug: string;

  @ApiProperty({ example: 'Google Workspace' })
  name: string;

  @ApiPropertyOptional({ example: 'google', nullable: true })
  preset: string | null;
}
