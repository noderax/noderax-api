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

@Entity({ name: 'node_installs' })
export class NodeInstallEntity {
  @ApiProperty({
    format: 'uuid',
    example: 'f6f9b1a7-62de-4d53-b37a-c6e1ffefbb6f',
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

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    example: 'd9f0f85a-b86f-4e7b-a917-6a3f61b44c2b',
  })
  @Index()
  @Column({ type: 'uuid', nullable: true })
  teamId: string | null;

  @ApiProperty({
    example: 'Production Node EU-1',
  })
  @Column({ length: 120 })
  nodeName: string;

  @ApiPropertyOptional({
    example: 'Primary web node in eu-central-1',
    nullable: true,
  })
  @Column({ type: 'text', nullable: true })
  description: string | null;

  @ApiHideProperty()
  @Column({ length: 255, select: false })
  tokenHash: string;

  @ApiHideProperty()
  @Index({ unique: true })
  @Column({ length: 64, select: false })
  tokenLookupHash: string;

  @ApiPropertyOptional({
    example: 'srv-prod-01',
    nullable: true,
  })
  @Index()
  @Column({ length: 255, nullable: true })
  hostname: string | null;

  @ApiPropertyOptional({
    type: 'object',
    nullable: true,
    additionalProperties: true,
  })
  @Column({ type: 'jsonb', nullable: true })
  additionalInfo: Record<string, unknown> | null;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    example: 'b7f88611-b63e-4c95-9f37-4afb5c0cf275',
  })
  @Index()
  @Column({ type: 'uuid', nullable: true })
  nodeId: string | null;

  @ApiPropertyOptional({
    format: 'date-time',
    nullable: true,
    example: '2026-03-31T12:34:56.000Z',
  })
  @Column({ type: 'timestamptz', nullable: true })
  consumedAt: Date | null;

  @ApiProperty({
    format: 'date-time',
    example: '2026-03-31T12:49:56.000Z',
  })
  @Index()
  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @ApiProperty({
    format: 'date-time',
    example: '2026-03-31T12:34:56.000Z',
  })
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
