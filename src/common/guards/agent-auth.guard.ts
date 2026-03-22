import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { NodesService } from '../../modules/nodes/nodes.service';
import { TasksService } from '../../modules/tasks/tasks.service';
import { AuthenticatedAgent } from '../types/authenticated-agent.type';

@Injectable()
export class AgentAuthGuard implements CanActivate {
  private readonly logger = new Logger(AgentAuthGuard.name);

  constructor(
    private readonly nodesService: NodesService,
    @Optional() private readonly tasksService?: TasksService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      agent?: AuthenticatedAgent;
      method?: string;
      originalUrl?: string;
      url?: string;
    }>();
    const path = request.originalUrl ?? request.url ?? 'unknown';
    const method = request.method ?? 'UNKNOWN';

    const authorization = request.headers.authorization;
    const authorizationHeader = this.extractHeader(authorization);
    const bearer = this.extractBearerToken(authorization);
    const nodeId = this.extractHeader(request.headers['x-agent-node-id']);

    if (!bearer || !nodeId) {
      const missingHeaders: string[] = [];
      if (!nodeId) {
        missingHeaders.push('x-agent-node-id');
      }
      if (!bearer) {
        missingHeaders.push('authorization-bearer');
      }

      this.logger.warn(
        JSON.stringify({
          msg: 'agent-http.auth.failed',
          path,
          method,
          reason: 'missing-required-headers',
          missingHeaders,
          providedHeaders: {
            authorization: authorizationHeader
              ? this.maskAuthorizationHeader(authorizationHeader)
              : null,
            xAgentNodeId: nodeId ?? null,
          },
          hasAuthorizationHeader: Boolean(authorizationHeader),
          hasNodeIdHeader: Boolean(
            this.extractHeader(request.headers['x-agent-node-id']),
          ),
        }),
      );

      this.tasksService?.recordClaimUnauthorizedAttempt({
        path,
        method,
        reason: 'missing-required-headers',
      });

      throw new UnauthorizedException(
        'x-agent-node-id and Authorization: Bearer <agent-token> are required',
      );
    }

    try {
      await this.nodesService.authenticateAgent(nodeId, bearer);
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          msg: 'agent-http.auth.failed',
          path,
          method,
          reason: 'invalid-agent-credentials',
          nodeId,
          providedHeaders: {
            authorization: authorizationHeader
              ? this.maskAuthorizationHeader(authorizationHeader)
              : null,
            xAgentNodeId: nodeId,
          },
          hasAuthorizationHeader: true,
          hasNodeIdHeader: true,
        }),
      );
      this.tasksService?.recordClaimUnauthorizedAttempt({
        path,
        method,
        reason: 'invalid-agent-credentials',
      });
      throw error;
    }

    request.agent = {
      nodeId,
      agentToken: bearer,
    };

    this.logger.debug(
      JSON.stringify({
        msg: 'agent-http.auth.succeeded',
        path,
        method,
        nodeId,
      }),
    );

    return true;
  }

  private extractBearerToken(
    authorization: string | string[] | undefined,
  ): string | null {
    const value = this.extractHeader(authorization);
    if (!value) {
      return null;
    }

    const [scheme, token] = value.split(' ');
    if (!scheme || !token || scheme.toLowerCase() !== 'bearer') {
      return null;
    }

    const normalized = token.trim();
    return normalized.length > 0 ? normalized : null;
  }

  private extractHeader(value: string | string[] | undefined): string | null {
    if (Array.isArray(value)) {
      const first = value[0]?.trim();
      return first && first.length > 0 ? first : null;
    }

    if (typeof value !== 'string') {
      return null;
    }

    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  private maskAuthorizationHeader(value: string): string {
    const [scheme] = value.split(' ');
    const normalizedScheme = scheme?.trim();
    if (!normalizedScheme) {
      return '***';
    }

    return `${normalizedScheme} ***`;
  }
}
