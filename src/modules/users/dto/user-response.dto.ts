import { ApiProperty } from '@nestjs/swagger';
import { DEFAULT_TIMEZONE } from '../../../common/utils/timezone.util';
import { UserRole } from '../entities/user-role.enum';

export class UserResponseDto {
  @ApiProperty({
    format: 'uuid',
    example: '4d2d2219-5d3e-4761-a79b-3c09ae88d6d3',
  })
  id: string;

  @ApiProperty({
    example: 'admin@example.com',
  })
  email: string;

  @ApiProperty({
    example: 'Noderax Admin',
  })
  name: string;

  @ApiProperty({
    enum: UserRole,
    enumName: 'UserRole',
    example: UserRole.PLATFORM_ADMIN,
  })
  role: UserRole;

  @ApiProperty({
    example: true,
  })
  isActive: boolean;

  @ApiProperty({
    example: DEFAULT_TIMEZONE,
  })
  timezone: string;

  @ApiProperty({
    enum: ['pending', 'accepted', 'revoked'],
    example: 'accepted',
  })
  inviteStatus: 'pending' | 'accepted' | 'revoked';

  @ApiProperty({
    format: 'date-time',
    nullable: true,
    example: '2026-03-17T12:30:00.000Z',
  })
  lastInvitedAt: Date | null;

  @ApiProperty({
    format: 'date-time',
    nullable: true,
    example: '2026-03-17T12:45:00.000Z',
  })
  activatedAt: Date | null;

  @ApiProperty({
    example: true,
  })
  criticalEventEmailsEnabled: boolean;

  @ApiProperty({
    example: true,
  })
  enrollmentEmailsEnabled: boolean;

  @ApiProperty({
    format: 'date-time',
    example: '2026-03-17T12:30:00.000Z',
  })
  createdAt: Date;

  @ApiProperty({
    format: 'date-time',
    example: '2026-03-17T12:30:00.000Z',
  })
  updatedAt: Date;
}
