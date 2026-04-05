import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { NodesModule } from '../nodes/nodes.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { AgentRealtimeModule } from '../agent-realtime/agent-realtime.module';
import { RedisModule } from '../../redis/redis.module';
import { TerminalSessionChunkEntity } from './entities/terminal-session-chunk.entity';
import { TerminalSessionEntity } from './entities/terminal-session.entity';
import { TerminalSessionsService } from './terminal-sessions.service';
import { TerminalSessionsController } from './terminal-sessions.controller';
import { TerminalGateway } from './terminal.gateway';
import { TerminalSocketAuthService } from './terminal-socket-auth.service';
import { TerminalSessionSchemaBootstrap } from './bootstrap/terminal-session-schema.bootstrap';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TerminalSessionEntity,
      TerminalSessionChunkEntity,
    ]),
    AuthModule,
    AuditLogsModule,
    forwardRef(() => NodesModule),
    forwardRef(() => WorkspacesModule),
    RedisModule,
    forwardRef(() => AgentRealtimeModule),
  ],
  controllers: [TerminalSessionsController],
  providers: [
    TerminalSessionsService,
    TerminalGateway,
    TerminalSocketAuthService,
    TerminalSessionSchemaBootstrap,
  ],
  exports: [TerminalSessionsService],
})
export class TerminalSessionsModule {}
