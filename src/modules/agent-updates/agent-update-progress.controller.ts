import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiBody,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentAgent } from '../../common/decorators/current-agent.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { SWAGGER_BEARER_AUTH_NAME } from '../../common/constants/swagger.constants';
import { AgentAuthGuard } from '../../common/guards/agent-auth.guard';
import { AuthenticatedAgent } from '../../common/types/authenticated-agent.type';
import { ReportAgentUpdateProgressDto } from './dto/report-agent-update-progress.dto';
import { AgentUpdateRolloutTargetDto } from './dto/agent-update-rollout.dto';
import { AgentUpdatesService } from './agent-updates.service';

@ApiTags('Agent Updates (Agent)')
@ApiBearerAuth(SWAGGER_BEARER_AUTH_NAME)
@ApiHeader({
  name: 'x-agent-node-id',
  required: true,
  description: 'Authenticated node id paired with bearer agent token.',
})
@ApiUnauthorizedResponse({
  description: 'Invalid agent authentication headers.',
})
@Public()
@UseGuards(AgentAuthGuard)
@SkipThrottle()
@Controller('agent-updates')
export class AgentUpdateProgressController {
  constructor(private readonly agentUpdatesService: AgentUpdatesService) {}

  @Post('targets/:targetId/progress')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Report detached agent update progress',
  })
  @ApiBody({ type: ReportAgentUpdateProgressDto })
  @ApiOkResponse({
    type: AgentUpdateRolloutTargetDto,
  })
  reportProgress(
    @Param('targetId') targetId: string,
    @Body() dto: ReportAgentUpdateProgressDto,
    @CurrentAgent() agent: AuthenticatedAgent,
  ) {
    return this.agentUpdatesService.handleAgentProgress(targetId, dto, agent);
  }
}
