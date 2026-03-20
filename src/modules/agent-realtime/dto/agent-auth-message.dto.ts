import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class AgentAuthMessageDto {
  @ApiProperty({
    example: 'agent.auth',
    description: 'Protocol message type marker.',
  })
  @IsString()
  @IsIn(['agent.auth'])
  type: 'agent.auth';

  @ApiProperty({
    format: 'uuid',
    example: 'b7f88611-b63e-4c95-9f37-4afb5c0cf275',
  })
  @IsUUID()
  nodeId: string;

  @ApiProperty({
    example: 'af0fe67dfb6d233db5462db4b8f19f65aa84fb304e2955546554a938d2f2b84f',
  })
  @IsString()
  @MinLength(16)
  agentToken: string;
}
