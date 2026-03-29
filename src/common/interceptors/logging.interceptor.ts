import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const startedAt = Date.now();

    const response = context.switchToHttp().getResponse();
    const correlationId = request.headers['x-correlation-id'] || 'no-id';

    return next.handle().pipe(
      tap(() => {
        const duration = Date.now() - startedAt;
        const statusCode = response.statusCode;
        this.logger.log(
          `[${correlationId}] ${request.method} ${request.originalUrl} ${statusCode} ${duration}ms`,
        );
      }),
    );
  }
}
