import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';
import { ValidateNested } from 'class-validator';
import { NodeRootAccessAgentReportDto } from '../../nodes/dto/node-root-access-state.dto';

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

  @ApiPropertyOptional({
    example: '1.0.0',
    description:
      'Optional runtime agent version reported during realtime authentication.',
  })
  @IsOptional()
  @IsString()
  agentVersion?: string;

  @ApiPropertyOptional({
    example: '24.04',
    description:
      'Optional platform version reported during realtime authentication.',
  })
  @IsOptional()
  @IsString()
  platformVersion?: string;

  @ApiPropertyOptional({
    example: '6.8.0-57-generic',
    description:
      'Optional kernel version reported during realtime authentication.',
  })
  @IsOptional()
  @IsString()
  kernelVersion?: string;

  @ApiPropertyOptional({
    type: NodeRootAccessAgentReportDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => NodeRootAccessAgentReportDto)
  rootAccess?: NodeRootAccessAgentReportDto;
}
