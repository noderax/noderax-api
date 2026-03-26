import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { InstallSetupDto } from './dto/install-setup.dto';
import { InstallSetupResponseDto } from './dto/install-setup-response.dto';
import { SetupStatusResponseDto } from './dto/setup-status-response.dto';
import { ValidatePostgresConnectionDto } from './dto/validate-postgres-connection.dto';
import { ValidatePostgresResponseDto } from './dto/validate-postgres-response.dto';
import { ValidateRedisConnectionDto } from './dto/validate-redis-connection.dto';
import { ValidateRedisResponseDto } from './dto/validate-redis-response.dto';
import { SetupService } from './setup.service';

@ApiTags('Setup')
@Public()
@Throttle({
  default: {
    limit: 10,
    ttl: 60_000,
  },
})
@Controller('setup')
export class SetupController {
  constructor(private readonly setupService: SetupService) {}

  @Get('status')
  @ApiOperation({
    summary: 'Read installer state',
  })
  @ApiOkResponse({
    type: SetupStatusResponseDto,
  })
  getStatus() {
    return this.setupService.getStatus();
  }

  @Post('validate/postgres')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Validate PostgreSQL connectivity for first-time setup',
  })
  @ApiOkResponse({
    type: ValidatePostgresResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'PostgreSQL connection failed.',
  })
  @ApiConflictResponse({
    description: 'Setup already completed.',
  })
  validatePostgres(@Body() dto: ValidatePostgresConnectionDto) {
    return this.setupService.validatePostgres(dto);
  }

  @Post('validate/redis')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Validate Redis connectivity for first-time setup',
  })
  @ApiOkResponse({
    type: ValidateRedisResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Redis connection failed.',
  })
  @ApiConflictResponse({
    description: 'Setup already completed.',
  })
  validateRedis(@Body() dto: ValidateRedisConnectionDto) {
    return this.setupService.validateRedis(dto);
  }

  @Post('install')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Provision the initial Noderax installation',
  })
  @ApiOkResponse({
    type: InstallSetupResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Input validation or infrastructure validation failed.',
  })
  @ApiConflictResponse({
    description: 'Setup already completed or database is not empty.',
  })
  install(@Body() dto: InstallSetupDto) {
    return this.setupService.install(dto);
  }
}
