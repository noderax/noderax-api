import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  PACKAGE_TASK_TYPES,
  PackageTaskType,
} from '../../../common/constants/task-types.constants';
import { TaskStatus } from '../../tasks/entities/task-status.enum';

export class PackageTaskAcceptedDto {
  @ApiProperty({
    format: 'uuid',
    example: 'ec9f97f2-7b56-4a7e-a7cb-5c957e9d32d8',
  })
  taskId: string;

  @ApiProperty({
    enum: TaskStatus,
    enumName: 'TaskStatus',
    example: TaskStatus.QUEUED,
  })
  taskStatus: TaskStatus;

  @ApiProperty({
    format: 'uuid',
    example: 'b7f88611-b63e-4c95-9f37-4afb5c0cf275',
  })
  nodeId: string;

  @ApiProperty({
    enum: PACKAGE_TASK_TYPES,
    example: 'packageInstall',
  })
  operation: PackageTaskType;

  @ApiProperty({
    type: String,
    isArray: true,
    example: ['nginx'],
  })
  names: string[];

  @ApiPropertyOptional({
    example: false,
    nullable: true,
  })
  purge: boolean | null;

  @ApiPropertyOptional({
    example: 'nginx',
    nullable: true,
  })
  term: string | null;
}
