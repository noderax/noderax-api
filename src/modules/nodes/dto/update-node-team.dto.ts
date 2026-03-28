import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class UpdateNodeTeamDto {
  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'Assign the node to a workspace team, or omit to clear.',
  })
  @IsOptional()
  @IsUUID()
  teamId?: string;
}
