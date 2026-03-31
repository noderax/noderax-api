import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { NodeEntity } from '../nodes/entities/node.entity';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { WsJwtAuthGuard } from './guards/ws-jwt-auth.guard';
import { WsNodeSubscriptionGuard } from './guards/ws-node-subscription.guard';
import { WsWorkspaceSubscriptionGuard } from './guards/ws-workspace-subscription.guard';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeAuthService } from './services/realtime-auth.service';
import { RealtimeAuthorizationService } from './services/realtime-authorization.service';
import { RealtimePubsubBridgeService } from './services/realtime-pubsub-bridge.service';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([NodeEntity]),
    WorkspacesModule,
  ],
  providers: [
    RealtimeGateway,
    RealtimePubsubBridgeService,
    RealtimeAuthService,
    RealtimeAuthorizationService,
    WsJwtAuthGuard,
    WsNodeSubscriptionGuard,
    WsWorkspaceSubscriptionGuard,
  ],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
