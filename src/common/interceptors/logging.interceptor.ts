import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, finalize } from 'rxjs';
import { buildHttpLogContext } from '../utils/http-log-context.util';
import { PrometheusMetricsService } from '../../runtime/prometheus-metrics.service';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  constructor(
    private readonly prometheusMetricsService: PrometheusMetricsService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const startedAt = Date.now();

    const response = context.switchToHttp().getResponse();
    const logContext = buildHttpLogContext(request);

    return next.handle().pipe(
      finalize(() => {
        const duration = Date.now() - startedAt;
        const statusCode = response.statusCode;
        const routeLabel = logContext.route ?? logContext.url;

        this.prometheusMetricsService.incrementCounter(
          'noderax_http_requests_total',
          1,
          {
            method: logContext.method,
            route: routeLabel,
            status_code: statusCode,
          },
          'Total HTTP requests handled by the API.',
        );
        this.prometheusMetricsService.observeSummary(
          'noderax_http_request_duration_seconds',
          duration / 1000,
          {
            method: logContext.method,
            route: routeLabel,
          },
          'Observed HTTP request duration in seconds.',
        );

        this.logger.log(
          JSON.stringify({
            msg: 'http.request.completed',
            ...logContext,
            statusCode,
            durationMs: duration,
          }),
        );
      }),
    );
  }
}
