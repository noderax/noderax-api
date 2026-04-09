import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { PrometheusMetricsService } from '../../runtime/prometheus-metrics.service';
import { buildHttpLogContext } from '../utils/http-log-context.util';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(
    private readonly prometheusMetricsService: PrometheusMetricsService,
  ) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse =
      exception instanceof HttpException
        ? exception.getResponse()
        : { message: 'Internal server error' };

    const normalizedResponse =
      this.normalizeExceptionResponse(exceptionResponse);

    this.prometheusMetricsService.incrementCounter(
      'noderax_http_request_errors_total',
      1,
      {
        method: request.method,
        route: request.route?.path ?? request.originalUrl,
        status_code: status,
      },
      'HTTP error responses handled by the global exception filter.',
    );

    if (!(exception instanceof HttpException) || status >= 500) {
      const error = exception as Error;
      this.logger.error(
        JSON.stringify({
          msg: 'http.request.failed',
          ...buildHttpLogContext(request),
          statusCode: status,
          errorMessage: error?.message ?? 'Unknown error',
          stack: error?.stack ?? null,
        }),
      );
    }

    response.status(status).json({
      statusCode: status,
      path: request.url,
      timestamp: new Date().toISOString(),
      ...normalizedResponse,
    });
  }

  private normalizeExceptionResponse(
    exceptionResponse: string | object,
  ): Record<string, unknown> {
    if (typeof exceptionResponse === 'string') {
      return { message: exceptionResponse };
    }

    const responseBody = {
      ...(exceptionResponse as Record<string, unknown>),
    };
    const rawMessage = responseBody.message;

    if (!Array.isArray(rawMessage)) {
      return responseBody;
    }

    const errors = rawMessage.map((entry) =>
      typeof entry === 'string' ? entry : JSON.stringify(entry),
    );

    return {
      ...responseBody,
      message: errors.join('; '),
      errors,
    };
  }
}
