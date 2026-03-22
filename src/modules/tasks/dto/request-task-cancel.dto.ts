import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RequestTaskCancelDto {
  @ApiPropertyOptional({
    example: 'Stopped by operator from dashboard',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
