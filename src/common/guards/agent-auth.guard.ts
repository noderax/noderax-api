import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  NotFoundException,
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
    const headerKeys = Object.keys(request.headers ?? {});

    const authorizationHeader = this.getHeaderValue(
      request.headers,
      'authorization',
    );
    const bearer = this.extractBearerToken(authorizationHeader);
    const nodeId = this.getHeaderValue(request.headers, 'x-agent-node-id');

    this.logger.debug(
      JSON.stringify({
        msg: 'agent-http.auth.check',
        path,
        method,
        hasAuthorizationHeader: Boolean(authorizationHeader),
        hasNodeIdHeader: Boolean(nodeId),
        authorizationScheme: authorizationHeader
          ? (authorizationHeader.split(' ')[0] ?? null)
          : null,
        tokenPresent: Boolean(bearer),
        tokenPreview: bearer ? this.maskToken(bearer) : null,
        nodeIdPreview: nodeId ? this.maskNodeId(nodeId) : null,
        headerKeys,
      }),
    );

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
          hasNodeIdHeader: Boolean(nodeId),
          headerKeys,
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
      const reason = this.resolveAuthFailureReason(error);
      this.logger.warn(
        JSON.stringify({
          msg: 'agent-http.auth.failed',
          path,
          method,
          reason,
          nodeId: this.maskNodeId(nodeId),
          providedHeaders: {
            authorization: authorizationHeader
              ? this.maskAuthorizationHeader(authorizationHeader)
              : null,
            xAgentNodeId: nodeId,
          },
          hasAuthorizationHeader: true,
          hasNodeIdHeader: true,
          headerKeys,
        }),
      );
      this.tasksService?.recordClaimUnauthorizedAttempt({
        path,
        method,
        reason,
      });
      throw new UnauthorizedException('Invalid agent credentials');
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
    authorization: string | string[] | null,
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

  private getHeaderValue(
    headers: Record<string, string | string[] | undefined>,
    name: string,
  ): string | null {
    const direct = this.extractHeader(headers[name]);
    if (direct) {
      return direct;
    }

    const lowerName = name.toLowerCase();
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === lowerName) {
        return this.extractHeader(value);
      }
    }

    return null;
  }

  private resolveAuthFailureReason(error: unknown): string {
    if (error instanceof NotFoundException) {
      return 'node-not-found-or-revoked';
    }

    if (error instanceof UnauthorizedException) {
      const response = error.getResponse();
      const message =
        typeof response === 'string'
          ? response
          : Array.isArray((response as { message?: unknown }).message)
            ? (response as { message?: string[] }).message?.join(' ')
            : ((response as { message?: string }).message ?? '');

      const normalized = message.toLowerCase();
      if (normalized.includes('not configured')) {
        return 'token-missing-on-node';
      }
      if (normalized.includes('invalid agent token')) {
        return 'node-token-mismatch';
      }
      if (normalized.includes('inactive') || normalized.includes('revoked')) {
        return 'node-inactive-or-revoked';
      }

      return 'invalid-agent-credentials';
    }

    return 'auth-validation-error';
  }

  private maskAuthorizationHeader(value: string): string {
    const [scheme] = value.split(' ');
    const normalizedScheme = scheme?.trim();
    if (!normalizedScheme) {
      return '***';
    }

    return `${normalizedScheme} ***`;
  }

  private maskToken(token: string): string {
    if (token.length <= 8) {
      return '***';
    }

    return `${token.slice(0, 4)}...${token.slice(-4)}`;
  }

  private maskNodeId(nodeId: string): string {
    if (nodeId.length <= 8) {
      return '***';
    }

    return `${nodeId.slice(0, 8)}...`;
  }
}
