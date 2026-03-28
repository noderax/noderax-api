import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class EnableNodeMaintenanceDto {
  @ApiPropertyOptional({
    example: 'Kernel patching window',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
