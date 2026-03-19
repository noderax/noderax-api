import { ApiProperty } from '@nestjs/swagger';

export class FinalizeEnrollmentResponseDto {
  @ApiProperty({
    format: 'uuid',
    example: 'b7f88611-b63e-4c95-9f37-4afb5c0cf275',
  })
  nodeId: string;

  @ApiProperty({
    example: '8eb84760b145bd1805e87ef4c0947b7b142d1bed3428f70f9b5f6f0a11baeb42',
    description:
      'Fresh agent credential returned once enrollment is approved. Only the hash is stored on the node record.',
  })
  agentToken: string;
}
