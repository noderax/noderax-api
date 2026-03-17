import { Body, Controller, Post } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { AgentsService } from './agents.service';
import { AgentHeartbeatDto } from './dto/agent-heartbeat.dto';
import { AgentRegisterDto } from './dto/agent-register.dto';

@Public()
@Controller('agent')
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  @Post('register')
  register(@Body() agentRegisterDto: AgentRegisterDto) {
    return this.agentsService.register(agentRegisterDto);
  }

  @Post('heartbeat')
  heartbeat(@Body() agentHeartbeatDto: AgentHeartbeatDto) {
    return this.agentsService.heartbeat(agentHeartbeatDto);
  }
}
