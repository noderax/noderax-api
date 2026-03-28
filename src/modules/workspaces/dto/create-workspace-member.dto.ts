import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsUUID } from 'class-validator';
import { WorkspaceMembershipRole } from '../entities/workspace-membership-role.enum';

export class CreateWorkspaceMemberDto {
  @ApiProperty({
    format: 'uuid',
    example: '4d2d2219-5d3e-4761-a79b-3c09ae88d6d3',
  })
  @IsUUID()
  userId: string;

  @ApiProperty({
    enum: WorkspaceMembershipRole,
    enumName: 'WorkspaceMembershipRole',
    example: WorkspaceMembershipRole.MEMBER,
  })
  @IsEnum(WorkspaceMembershipRole)
  role: WorkspaceMembershipRole;
}
