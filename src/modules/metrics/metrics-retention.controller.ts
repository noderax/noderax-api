import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { SWAGGER_BEARER_AUTH_NAME } from '../../common/constants/swagger.constants';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthenticatedUser } from '../../common/types/authenticated-user.type';
import { UserRole } from '../users/entities/user-role.enum';
import {
  MetricsRetentionRunResponseDto,
  MetricsRetentionSettingsDto,
  UpdateMetricsRetentionDto,
} from './dto/metrics-retention.dto';
import { MetricsRetentionService } from './metrics-retention.service';

@ApiTags('Metrics Retention')
@ApiBearerAuth(SWAGGER_BEARER_AUTH_NAME)
@ApiUnauthorizedResponse({
  description: 'JWT authentication required.',
})
@Roles(UserRole.PLATFORM_ADMIN)
@Controller('metrics/retention')
export class MetricsRetentionController {
  constructor(
    private readonly metricsRetentionService: MetricsRetentionService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Get metrics retention settings' })
  @ApiOkResponse({ type: MetricsRetentionSettingsDto })
  getSettings(): MetricsRetentionSettingsDto {
    return this.metricsRetentionService.getSettings();
  }

  @Patch()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Update metrics retention settings',
    description:
      'Enables/disables automatic cleanup and sets the retention window. Applies live without an API restart.',
  })
  @ApiOkResponse({ type: MetricsRetentionSettingsDto })
  updateSettings(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: UpdateMetricsRetentionDto,
  ): MetricsRetentionSettingsDto {
    return this.metricsRetentionService.updateSettings(dto, actor);
  }

  @Post('run')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Run metrics retention cleanup now',
    description:
      'Immediately deletes metrics older than the configured retention window, regardless of the enabled toggle.',
  })
  @ApiOkResponse({ type: MetricsRetentionRunResponseDto })
  runNow(
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<MetricsRetentionRunResponseDto> {
    return this.metricsRetentionService.runCleanupNow(actor);
  }
}
