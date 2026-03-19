import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class QueryPackageSearchDto {
  @ApiProperty({
    example: 'nginx',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  term: string;

  @ApiProperty({
    format: 'uuid',
    example: 'b7f88611-b63e-4c95-9f37-4afb5c0cf275',
  })
  @IsUUID()
  nodeId: string;
}
