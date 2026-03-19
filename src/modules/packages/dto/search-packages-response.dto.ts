import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PackageSearchResultDto } from './package-search-result.dto';
import { PackageTaskAcceptedDto } from './package-task-accepted.dto';

export class SearchPackagesResponseDto extends PackageTaskAcceptedDto {
  @ApiProperty({
    type: PackageSearchResultDto,
    isArray: true,
  })
  results: PackageSearchResultDto[];

  @ApiPropertyOptional({
    example: 'Task completed without a structured package result.',
    nullable: true,
  })
  error: string | null;
}
