import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EnrollmentStatus } from '../entities/enrollment-status.enum';

export class EnrollmentStatusResponseDto {
  @ApiProperty({
    enum: EnrollmentStatus,
    enumName: 'EnrollmentStatus',
    example: EnrollmentStatus.PENDING,
  })
  status: EnrollmentStatus;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    example: 'b7f88611-b63e-4c95-9f37-4afb5c0cf275',
  })
  nodeId?: string;

  @ApiPropertyOptional({
    nullable: true,
    example: '8eb84760b145bd1805e87ef4c0947b7b142d1bed3428f70f9b5f6f0a11baeb42',
  })
  agentToken?: string;
}
