import { PartialType } from '@nestjs/swagger';
import { CreateOidcProviderDto } from './create-oidc-provider.dto';

export class UpdateOidcProviderDto extends PartialType(CreateOidcProviderDto) {}
