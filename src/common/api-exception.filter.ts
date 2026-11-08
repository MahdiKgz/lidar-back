import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const statusCode =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const body =
      exception instanceof HttpException ? exception.getResponse() : null;
    const details =
      typeof body === 'object' && body !== null
        ? (body as { message?: string | string[]; error?: string })
        : null;
    // Raw SDK/Redis/PDAL errors and query strings can contain signed URLs or secrets.
    if (statusCode >= 500) this.logger.error(`Request failed (${statusCode})`);
    response.status(statusCode).json({
      statusCode,
      error:
        statusCode >= 500
          ? 'Internal Server Error'
          : (details?.error ?? 'Request Error'),
      message:
        statusCode >= 500
          ? 'An internal error occurred. Retry later.'
          : (details?.message ?? body ?? 'Request failed.'),
      timestamp: new Date().toISOString(),
      path: request.originalUrl.split('?')[0],
    });
  }
}
