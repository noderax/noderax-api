import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { WorkspaceMembershipRole } from '../entities/workspace-membership-role.enum';

export class UpdateWorkspaceMemberDto {
  @ApiProperty({
    enum: WorkspaceMembershipRole,
    enumName: 'WorkspaceMembershipRole',
    example: WorkspaceMembershipRole.ADMIN,
  })
  @IsEnum(WorkspaceMembershipRole)
  role: WorkspaceMembershipRole;
}
