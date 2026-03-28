import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MfaStatusDto {
  @ApiProperty({ example: true })
  mfaEnabled: boolean;

  @ApiPropertyOptional({
    type: String,
    isArray: true,
    nullable: true,
  })
  recoveryCodes?: string[] | null;
}
