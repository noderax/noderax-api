import { ApiProperty } from '@nestjs/swagger';

export class OidcProviderStartResponseDto {
  @ApiProperty({
    example:
      'https://accounts.google.com/o/oauth2/v2/auth?client_id=example&redirect_uri=https%3A%2F%2Fapp.noderax.net%2Fapi%2Fauth%2Foidc%2Fgoogle%2Fcallback&response_type=code&scope=openid%20email%20profile&state=...',
  })
  authorizationUrl: string;
}
