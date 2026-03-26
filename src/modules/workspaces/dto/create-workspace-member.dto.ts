import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { WorkspaceMembershipRole } from '../entities/workspace-membership-role.enum';

export class CreateWorkspaceMemberDto {
  @ApiProperty({
    example: 'ops@example.com',
  })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({
    example: 'Platform Operator',
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @ApiPropertyOptional({
    example: 'StrongPassword123!',
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  @ApiProperty({
    enum: WorkspaceMembershipRole,
    enumName: 'WorkspaceMembershipRole',
    example: WorkspaceMembershipRole.MEMBER,
  })
  @IsEnum(WorkspaceMembershipRole)
  role: WorkspaceMembershipRole;
}
