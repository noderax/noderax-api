import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

@Unique('UQ_team_memberships_team_user', ['teamId', 'userId'])
@Entity({ name: 'team_memberships' })
export class TeamMembershipEntity {
  @ApiProperty({
    format: 'uuid',
    example: '339ed419-4daa-4b84-81f1-5ee1b85a1c31',
  })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({
    format: 'uuid',
    example: 'ce391c51-5f42-4d77-bef2-6107be4db31e',
  })
  @Index()
  @Column({ type: 'uuid' })
  teamId: string;

  @ApiProperty({
    format: 'uuid',
    example: '4d2d2219-5d3e-4761-a79b-3c09ae88d6d3',
  })
  @Index()
  @Column({ type: 'uuid' })
  userId: string;

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
}
