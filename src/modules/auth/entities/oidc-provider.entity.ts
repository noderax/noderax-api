import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Index('IDX_oidc_providers_enabled', ['enabled'])
@Entity({ name: 'oidc_providers' })
export class OidcProviderEntity {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty()
  @Column({ length: 80, unique: true })
  slug: string;

  @ApiProperty()
  @Column({ length: 120 })
  name: string;

  @ApiPropertyOptional({ nullable: true })
  @Column({ length: 40, nullable: true })
  preset: string | null;

  @ApiProperty()
  @Column({ length: 255 })
  issuer: string;

  @ApiProperty()
  @Column({ length: 255 })
  clientId: string;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'text', nullable: true, select: false })
  clientSecretEncrypted: string | null;

  @ApiProperty()
  @Column({ length: 255 })
  discoveryUrl: string;

  @ApiProperty({
    type: String,
    isArray: true,
  })
  @Column({ type: 'jsonb', default: ['openid', 'email', 'profile'] })
  scopes: string[];

  @ApiProperty({ example: true })
  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @ApiProperty({ format: 'date-time' })
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @ApiProperty({ format: 'date-time' })
  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
