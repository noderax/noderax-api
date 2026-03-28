import { ApiProperty } from '@nestjs/swagger';
import { WorkspaceSearchHitDto } from './workspace-search-hit.dto';

export class WorkspaceSearchResponseDto {
  @ApiProperty({
    type: WorkspaceSearchHitDto,
    isArray: true,
  })
  nodes: WorkspaceSearchHitDto[];

  @ApiProperty({
    type: WorkspaceSearchHitDto,
    isArray: true,
  })
  tasks: WorkspaceSearchHitDto[];

  @ApiProperty({
    type: WorkspaceSearchHitDto,
    isArray: true,
  })
  scheduledTasks: WorkspaceSearchHitDto[];

  @ApiProperty({
    type: WorkspaceSearchHitDto,
    isArray: true,
  })
  events: WorkspaceSearchHitDto[];

  @ApiProperty({
    type: WorkspaceSearchHitDto,
    isArray: true,
  })
  members: WorkspaceSearchHitDto[];

  @ApiProperty({
    type: WorkspaceSearchHitDto,
    isArray: true,
  })
  teams: WorkspaceSearchHitDto[];
}
