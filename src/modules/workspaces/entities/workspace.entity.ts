import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { DEFAULT_TIMEZONE } from '../../../common/utils/timezone.util';
import { WorkspaceMembershipRole } from './workspace-membership-role.enum';

@Entity({ name: 'workspaces' })
export class WorkspaceEntity {
  @ApiProperty({
    format: 'uuid',
    example: '9d4174b9-5dc2-4891-8d1b-f0a2f6c4e52c',
  })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({
    example: 'Default Workspace',
  })
  @Column({ length: 160 })
  name: string;

  @ApiProperty({
    example: 'default',
  })
  @Index({ unique: true })
  @Column({ length: 80 })
  slug: string;

  @ApiProperty({
    example: DEFAULT_TIMEZONE,
  })
  @Column({ length: 80, default: DEFAULT_TIMEZONE })
  defaultTimezone: string;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    example: '4d2d2219-5d3e-4761-a79b-3c09ae88d6d3',
  })
  @Column({ type: 'uuid', nullable: true })
  createdByUserId: string | null;

  @ApiProperty({
    example: false,
  })
  @Column({ type: 'boolean', default: false })
  isArchived: boolean;

  @ApiPropertyOptional({
    enum: WorkspaceMembershipRole,
    enumName: 'WorkspaceMembershipRole',
    nullable: true,
    example: WorkspaceMembershipRole.ADMIN,
  })
  currentUserRole?: WorkspaceMembershipRole | null;

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
