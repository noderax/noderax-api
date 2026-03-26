import { Body, Controller, Get, Header, Patch } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { SWAGGER_BEARER_AUTH_NAME } from '../../common/constants/swagger.constants';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../users/entities/user-role.enum';
import {
  PlatformSettingsResponseDto,
  UpdatePlatformSettingsDto,
} from './dto/platform-settings.dto';
import { PlatformSettingsService } from './platform-settings.service';

@ApiTags('Platform Settings')
@ApiBearerAuth(SWAGGER_BEARER_AUTH_NAME)
@ApiUnauthorizedResponse({
  description: 'JWT authentication required.',
})
@Roles(UserRole.PLATFORM_ADMIN)
@Controller('platform-settings')
export class PlatformSettingsController {
  constructor(
    private readonly platformSettingsService: PlatformSettingsService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Get platform settings',
    description:
      'Returns installer-managed platform runtime settings for admin configuration.',
  })
  @ApiOkResponse({
    description: 'Current platform settings.',
    type: PlatformSettingsResponseDto,
  })
  getSettings(): PlatformSettingsResponseDto {
    return this.platformSettingsService.getSettings();
  }

  @Patch()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Update platform settings',
    description:
      'Writes installer-managed runtime settings to install-state. A restart is required to apply them.',
  })
  @ApiOkResponse({
    description: 'Updated platform settings snapshot.',
    type: PlatformSettingsResponseDto,
  })
  updateSettings(
    @Body() dto: UpdatePlatformSettingsDto,
  ): PlatformSettingsResponseDto {
    return this.platformSettingsService.updateSettings(dto);
  }
}
