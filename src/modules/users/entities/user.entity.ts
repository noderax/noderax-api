import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { DEFAULT_TIMEZONE } from '../../../common/utils/timezone.util';
import { UserRole } from './user-role.enum';

@Entity({ name: 'users' })
export class UserEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true, length: 255 })
  email: string;

  @Column({ length: 120 })
  name: string;

  @Column({
    type: 'enum',
    enum: UserRole,
    enumName: 'user_role_enum',
    default: UserRole.USER,
  })
  role: UserRole;

  @Column({ select: false, nullable: true })
  passwordHash: string | null;

  @Column({ default: true })
  isActive: boolean;

  @Column({ length: 80, default: DEFAULT_TIMEZONE })
  timezone: string;

  @Column({ length: 24, default: 'accepted' })
  inviteStatus: 'pending' | 'accepted' | 'revoked';

  @Column({ type: 'timestamptz', nullable: true })
  lastInvitedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  activatedAt: Date | null;

  @Column({ type: 'boolean', default: true })
  criticalEventEmailsEnabled: boolean;

  @Column({ type: 'boolean', default: true })
  enrollmentEmailsEnabled: boolean;

  @Column({ type: 'integer', default: 0 })
  sessionVersion: number;

  @Column({ type: 'boolean', default: false })
  mfaEnabled: boolean;

  @Column({ type: 'text', nullable: true, select: false })
  mfaSecretEncrypted: string | null;

  @Column({ type: 'text', nullable: true, select: false })
  mfaPendingSecretEncrypted: string | null;

  @Column({ type: 'jsonb', nullable: true, select: false })
  mfaRecoveryCodes: string[] | null;

  @Column({ type: 'timestamptz', nullable: true })
  mfaEnabledAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
