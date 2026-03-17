import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { AgentsService } from './agents.service';
import { AgentHeartbeatDto } from './dto/agent-heartbeat.dto';
import { AgentHeartbeatResponseDto } from './dto/agent-heartbeat-response.dto';
import { AgentRegisterDto } from './dto/agent-register.dto';
import { AgentRegisterResponseDto } from './dto/agent-register-response.dto';

@ApiTags('Agents')
@Public()
@Controller('agent')
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  @Post('register')
  @ApiOperation({
    summary: 'Register a new agent',
    description:
      'Creates or refreshes a node record and returns the node ID with an agent token.',
  })
  @ApiBody({ type: AgentRegisterDto })
  @ApiCreatedResponse({
    description: 'Agent successfully registered.',
    type: AgentRegisterResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'Invalid or missing enrollment token.',
  })
  register(@Body() agentRegisterDto: AgentRegisterDto) {
    return this.agentsService.register(agentRegisterDto);
  }

  @Post('heartbeat')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Send an agent heartbeat',
    description:
      'Authenticates the agent token, updates last seen time, and marks the node online.',
  })
  @ApiBody({ type: AgentHeartbeatDto })
  @ApiOkResponse({
    description: 'Heartbeat accepted.',
    type: AgentHeartbeatResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid node ID or agent token.',
  })
  heartbeat(@Body() agentHeartbeatDto: AgentHeartbeatDto) {
    return this.agentsService.heartbeat(agentHeartbeatDto);
  }
}
