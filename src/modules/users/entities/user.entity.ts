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

  @Column({ select: false })
  passwordHash: string;

  @Column({ default: true })
  isActive: boolean;

  @Column({ length: 80, default: DEFAULT_TIMEZONE })
  timezone: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
