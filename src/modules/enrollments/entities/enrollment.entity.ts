import {
  ApiHideProperty,
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { EnrollmentStatus } from './enrollment-status.enum';

@Entity({ name: 'enrollments' })
export class EnrollmentEntity {
  @ApiProperty({
    format: 'uuid',
    example: '4f49db19-d280-4ba8-b454-66dccca5464f',
  })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({
    example: 'admin@example.com',
  })
  @Column({ length: 255 })
  email: string;

  @ApiHideProperty()
  @Column({ length: 255, select: false })
  tokenHash: string;

  @ApiHideProperty()
  @Index({ unique: true })
  @Column({ length: 64, select: false })
  tokenLookupHash: string;

  @ApiProperty({
    example: 'srv-01',
  })
  @Column({ length: 255 })
  hostname: string;

  @ApiPropertyOptional({
    type: 'object',
    nullable: true,
    additionalProperties: true,
  })
  @Column({ type: 'jsonb', nullable: true })
  additionalInfo: Record<string, unknown> | null;

  @ApiProperty({
    format: 'date-time',
    example: '2026-03-19T14:00:00.000Z',
  })
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @ApiProperty({
    format: 'date-time',
    example: '2026-03-19T14:15:00.000Z',
  })
  @Index()
  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @ApiProperty({
    enum: EnrollmentStatus,
    enumName: 'EnrollmentStatus',
    example: EnrollmentStatus.PENDING,
  })
  @Index()
  @Column({
    type: 'enum',
    enum: EnrollmentStatus,
    enumName: 'enrollment_status_enum',
    default: EnrollmentStatus.PENDING,
  })
  status: EnrollmentStatus;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    example: 'b7f88611-b63e-4c95-9f37-4afb5c0cf275',
  })
  @Index()
  @Column({ type: 'uuid', nullable: true })
  nodeId: string | null;

  @ApiHideProperty()
  @Column({ type: 'text', nullable: true, select: false })
  agentToken: string | null;
}
