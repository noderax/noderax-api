import { IsString, IsUUID, MinLength } from 'class-validator';

export class AgentHeartbeatDto {
  @IsUUID()
  nodeId: string;

  @IsString()
  @MinLength(32)
  agentToken: string;
}
