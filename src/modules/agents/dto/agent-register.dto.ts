import { Transform } from 'class-transformer';
import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class AgentRegisterDto {
  @ApiProperty({
    example: 'srv-01',
    description: 'Unique hostname of the registering server.',
  })
  @Transform(({ value }) => value?.trim().toLowerCase())
  @IsString()
  @MinLength(2)
  hostname: string;

  @ApiProperty({
    example: 'ubuntu',
    description: 'Operating system label reported by the agent.',
  })
  @Transform(({ value }) => value?.trim())
  @IsOptional()
  @IsString()
  @MinLength(2)
  os?: string;

  @ApiProperty({
    example: 'amd64',
    description: 'CPU architecture reported by the agent.',
  })
  @Transform(({ value }) => value?.trim())
  @IsOptional()
  @IsString()
  @MinLength(2)
  arch?: string;

  @ApiProperty({
    example: 'your-token',
    description:
      'Shared enrollment token used during initial agent registration to prevent unauthorized servers from enrolling.',
  })
  @IsString()
  enrollmentToken: string;

  @ApiHideProperty()
  @IsOptional()
  @Transform(({ value }) => value?.trim())
  @IsString()
  operatingSystem?: string;

  @ApiHideProperty()
  @IsOptional()
  @Transform(({ value }) => value?.trim())
  @IsString()
  architecture?: string;

  @ApiHideProperty()
  @IsOptional()
  @Transform(({ value }) => value?.trim())
  @IsString()
  platform?: string;

  @ApiHideProperty()
  @IsOptional()
  @Transform(({ value }) => value?.trim())
  @IsString()
  platformVersion?: string;

  @ApiHideProperty()
  @IsOptional()
  @Transform(({ value }) => value?.trim())
  @IsString()
  kernelVersion?: string;

  @ApiHideProperty()
  @IsOptional()
  @Transform(({ value }) => value?.trim())
  @IsString()
  agentVersion?: string;
}
