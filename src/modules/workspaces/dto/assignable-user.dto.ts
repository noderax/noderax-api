import { ApiProperty } from '@nestjs/swagger';

export class AssignableUserDto {
  @ApiProperty({
    format: 'uuid',
    example: '4d2d2219-5d3e-4761-a79b-3c09ae88d6d3',
  })
  id: string;

  @ApiProperty({
    example: 'Operations User',
  })
  name: string;

  @ApiProperty({
    example: 'ops@example.com',
  })
  email: string;
}
