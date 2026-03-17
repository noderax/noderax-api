import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

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

    if (!(exception instanceof HttpException) || status >= 500) {
      const error = exception as Error;
      this.logger.error(
        `${request.method} ${request.url} failed with status ${status}`,
        error?.stack,
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
