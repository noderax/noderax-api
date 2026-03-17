import { ApiProperty } from '@nestjs/swagger';
import { NodeStatus } from '../../nodes/entities/node-status.enum';

export class AgentHeartbeatResponseDto {
  @ApiProperty({
    example: true,
  })
  acknowledged: boolean;

  @ApiProperty({
    format: 'uuid',
    example: 'b7f88611-b63e-4c95-9f37-4afb5c0cf275',
  })
  nodeId: string;

  @ApiProperty({
    enum: NodeStatus,
    enumName: 'NodeStatus',
    example: NodeStatus.ONLINE,
  })
  status: NodeStatus;

  @ApiProperty({
    format: 'date-time',
    example: '2026-03-17T12:32:10.000Z',
  })
  lastSeenAt: Date;
}
