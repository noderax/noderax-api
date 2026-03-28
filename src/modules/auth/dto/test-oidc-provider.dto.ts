import { OmitType } from '@nestjs/swagger';
import { CreateOidcProviderDto } from './create-oidc-provider.dto';

export class TestOidcProviderDto extends OmitType(CreateOidcProviderDto, [
  'slug',
  'name',
] as const) {}
