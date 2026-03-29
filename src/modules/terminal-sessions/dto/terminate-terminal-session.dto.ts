import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class TerminateTerminalSessionDto {
  @ApiPropertyOptional({ example: 'Operator requested stop' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
