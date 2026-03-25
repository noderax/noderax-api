import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateScheduledTaskDto {
  @ApiProperty({
    example: false,
  })
  @IsBoolean()
  enabled: boolean;
}
