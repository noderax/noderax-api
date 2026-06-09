import { ApiProperty } from '@nestjs/swagger';
import { NodeInstallStatusResponseDto } from './node-install-status-response.dto';

export class CreateNodeInstallResponseDto extends NodeInstallStatusResponseDto {
  @ApiProperty({
    example:
      'set -euo pipefail\ncurl -fsSLo "$tmp/install.sh" https://cdn.noderax.net/noderax-agent/install.sh\nminisign -Vm "$tmp/release-manifest.json" -P RW...',
  })
  installCommand: string;

  @ApiProperty({
    example: 'https://cdn.noderax.net/noderax-agent/install.sh',
  })
  scriptUrl: string;

  @ApiProperty({
    example:
      'https://cdn.noderax.net/noderax-agent/releases/latest/release-manifest.json',
  })
  releaseManifestUrl: string;

  @ApiProperty({
    example: 'https://api.noderax.net',
  })
  apiUrl: string;
}
