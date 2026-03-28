import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Index('UQ_oidc_identities_provider_subject', ['providerId', 'subject'], {
  unique: true,
})
@Entity({ name: 'oidc_identities' })
export class OidcIdentityEntity {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ format: 'uuid' })
  @Column({ type: 'uuid' })
  providerId: string;

  @ApiProperty({ format: 'uuid' })
  @Column({ type: 'uuid' })
  userId: string;

  @ApiProperty()
  @Column({ length: 255 })
  subject: string;

  @ApiProperty()
  @Column({ length: 255 })
  email: string;

  @ApiProperty({ format: 'date-time' })
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
