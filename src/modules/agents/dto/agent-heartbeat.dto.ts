import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import {
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

export class AgentHeartbeatDto {
  @ApiProperty({
    format: 'uuid',
    example: 'b7f88611-b63e-4c95-9f37-4afb5c0cf275',
    description: 'Node identifier returned during registration.',
  })
  @IsUUID()
  nodeId: string;

  @ApiProperty({
    example: '8eb84760b145bd1805e87ef4c0947b7b142d1bed3428f70f9b5f6f0a11baeb42',
    minLength: 32,
    description: 'Agent token returned during registration.',
  })
  @IsString()
  @MinLength(32)
  agentToken: string;

  @ApiHideProperty()
  @IsOptional()
  @IsString()
  @MinLength(1)
  agentVersion?: string;

  @ApiHideProperty()
  @IsOptional()
  @IsDateString()
  sentAt?: string;
}
