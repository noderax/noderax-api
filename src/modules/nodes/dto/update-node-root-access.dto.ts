import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsString,
  Length,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  NODE_ROOT_ACCESS_PROFILES,
  NodeRootAccessProfile,
} from '../entities/node-root-access-profile.enum';

export class UpdateNodeRootAccessDto {
  @ApiProperty({
    enum: NODE_ROOT_ACCESS_PROFILES,
    example: NodeRootAccessProfile.OPERATIONAL,
  })
  @IsIn(NODE_ROOT_ACCESS_PROFILES)
  profile: NodeRootAccessProfile;

  @ApiProperty({
    example: 30,
    minimum: 5,
    maximum: 120,
    required: false,
    description:
      'Required when enabling any non-off root access profile. Ignored when profile is off.',
  })
  @ValidateIf(
    (dto: UpdateNodeRootAccessDto) => dto.profile !== NodeRootAccessProfile.OFF,
  )
  @Transform(({ value }) =>
    value === '' || value === null ? undefined : Number(value),
  )
  @IsInt()
  @Min(5)
  @Max(120)
  durationMinutes?: number;

  @ApiProperty({
    example: 'Emergency package repair on srv-01',
    required: false,
    description:
      'Required when enabling any non-off root access profile. Ignored when profile is off.',
  })
  @ValidateIf(
    (dto: UpdateNodeRootAccessDto) => dto.profile !== NodeRootAccessProfile.OFF,
  )
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(3, 500)
  reason?: string;
}
