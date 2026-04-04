import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NodeRootAccessDesiredSnapshotDto } from '../../nodes/dto/node-root-access-state.dto';
import { TaskEntity } from '../entities/task.entity';

export class ClaimAgentTaskResponseDto {
  @ApiPropertyOptional({
    type: TaskEntity,
    nullable: true,
  })
  task: TaskEntity | null;

  @ApiProperty({
    example: false,
    description: 'Whether output returned by completion APIs was truncated.',
  })
  outputTruncated: boolean;

  @ApiPropertyOptional({
    type: NodeRootAccessDesiredSnapshotDto,
    nullable: true,
  })
  rootAccess: NodeRootAccessDesiredSnapshotDto | null;
}
