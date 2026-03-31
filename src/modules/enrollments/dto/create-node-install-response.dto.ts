import { ApiProperty } from '@nestjs/swagger';
import { NodeInstallStatusResponseDto } from './node-install-status-response.dto';

export class CreateNodeInstallResponseDto extends NodeInstallStatusResponseDto {
  @ApiProperty({
    example:
      'curl -fsSL https://cdn.noderax.net/noderax-agent/install.sh | sudo bash -s -- --api-url https://api.noderax.net --bootstrap-token abc123',
  })
  installCommand: string;

  @ApiProperty({
    example: 'https://cdn.noderax.net/noderax-agent/install.sh',
  })
  scriptUrl: string;

  @ApiProperty({
    example: 'https://api.noderax.net',
  })
  apiUrl: string;
}
