import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
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
}
