import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NodeStatus } from '../../nodes/entities/node-status.enum';

export class FleetNodeDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  workspaceId: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  hostname: string;

  @ApiProperty()
  os: string;

  @ApiProperty()
  arch: string;

  @ApiProperty({ enum: NodeStatus })
  status: NodeStatus;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  teamId: string | null;

  @ApiPropertyOptional({ nullable: true })
  teamName: string | null;

  @ApiProperty({ example: false })
  maintenanceMode: boolean;

  @ApiPropertyOptional({ nullable: true })
  maintenanceReason: string | null;

  @ApiPropertyOptional({ nullable: true })
  agentVersion: string | null;

  @ApiPropertyOptional({ nullable: true })
  platformVersion: string | null;

  @ApiPropertyOptional({ nullable: true })
  kernelVersion: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  lastVersionReportedAt: Date | null;

  @ApiProperty({ example: 'linux' })
  platformFamily: 'linux' | 'darwin';
}
