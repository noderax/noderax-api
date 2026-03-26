import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class AddTeamMemberDto {
  @ApiProperty({
    format: 'uuid',
    example: '4d2d2219-5d3e-4761-a79b-3c09ae88d6d3',
  })
  @IsUUID()
  userId: string;
}
