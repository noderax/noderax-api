import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { UserEntity } from '../../users/entities/user.entity';
import { WorkspaceEntity } from './workspace.entity';
import { WorkspaceMembershipRole } from './workspace-membership-role.enum';

@Unique('UQ_workspace_memberships_workspace_user', ['workspaceId', 'userId'])
@Entity({ name: 'workspace_memberships' })
export class WorkspaceMembershipEntity {
  @ApiProperty({
    format: 'uuid',
    example: 'f6e8eeb0-64dd-444b-857d-2d77d98537f2',
  })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({
    format: 'uuid',
    example: '9d4174b9-5dc2-4891-8d1b-f0a2f6c4e52c',
  })
  @Index()
  @Column({ type: 'uuid' })
  workspaceId: string;

  @ManyToOne(() => WorkspaceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspaceId' })
  workspace?: WorkspaceEntity;

  @ApiProperty({
    format: 'uuid',
    example: '4d2d2219-5d3e-4761-a79b-3c09ae88d6d3',
  })
  @Index()
  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user?: UserEntity;

  @ApiProperty({
    enum: WorkspaceMembershipRole,
    enumName: 'WorkspaceMembershipRole',
    example: WorkspaceMembershipRole.ADMIN,
  })
  @Column({
    type: 'enum',
    enum: WorkspaceMembershipRole,
    enumName: 'workspace_membership_role_enum',
    default: WorkspaceMembershipRole.MEMBER,
  })
  role: WorkspaceMembershipRole;

  @ApiPropertyOptional({
    example: 'Noderax Admin',
    nullable: true,
  })
  userName?: string | null;

  @ApiPropertyOptional({
    example: 'admin@example.com',
    nullable: true,
  })
  userEmail?: string | null;

  @ApiPropertyOptional({
    example: true,
    nullable: true,
  })
  userIsActive?: boolean | null;

  @ApiProperty({
    format: 'date-time',
    example: '2026-03-26T09:10:00.000Z',
  })
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @ApiProperty({
    format: 'date-time',
    example: '2026-03-26T09:10:00.000Z',
  })
  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
