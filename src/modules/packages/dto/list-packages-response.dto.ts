import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PackageDto } from './package.dto';
import { PackageTaskAcceptedDto } from './package-task-accepted.dto';

export class ListPackagesResponseDto extends PackageTaskAcceptedDto {
  @ApiProperty({
    type: PackageDto,
    isArray: true,
  })
  packages: PackageDto[];

  @ApiPropertyOptional({
    example: 'Task completed without a structured package result.',
    nullable: true,
  })
  error: string | null;
}
