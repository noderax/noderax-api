import { Controller, Get, Header } from '@nestjs/common';
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
import { TaskFlowDiagnosticsResponseDto } from './dto/task-flow-diagnostics-response.dto';
import { DiagnosticsService } from './diagnostics.service';

@ApiTags('Diagnostics')
@ApiBearerAuth(SWAGGER_BEARER_AUTH_NAME)
@Controller('diagnostics')
export class DiagnosticsController {
  constructor(private readonly diagnosticsService: DiagnosticsService) {}

  @Get('task-flow')
  @Roles(UserRole.PLATFORM_ADMIN)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Get task-flow diagnostics snapshot',
    description:
      'Returns stable claim/realtime counters for the diagnostics panel.',
  })
  @ApiOkResponse({
    description: 'Task flow diagnostics snapshot.',
    type: TaskFlowDiagnosticsResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'JWT authentication required.',
  })
  getTaskFlowDiagnostics(): Promise<TaskFlowDiagnosticsResponseDto> {
    return this.diagnosticsService.getTaskFlowDiagnostics();
  }
}
