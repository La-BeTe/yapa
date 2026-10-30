import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { AppError, ErrorCode } from './app-error';
import { ErrorEnvelope, failure } from './envelope';

const STATUS_CODES: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: ErrorCode.VALIDATION_ERROR,
  [HttpStatus.UNAUTHORIZED]: ErrorCode.UNAUTHORIZED,
  [HttpStatus.NOT_FOUND]: ErrorCode.NOT_FOUND,
};

export function toErrorResponse(exception: unknown): { status: number; body: ErrorEnvelope } {
  if (exception instanceof AppError) {
    return {
      status: exception.httpStatus,
      body: failure(exception.code, exception.message, exception.details),
    };
  }

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const response = exception.getResponse();
    const code = STATUS_CODES[status] ?? (status >= 500 ? ErrorCode.INTERNAL_ERROR : 'HTTP_ERROR');
    // class-validator failures arrive as { message: string[] } from the ValidationPipe.
    const details =
      typeof response === 'object' &&
      response !== null &&
      Array.isArray((response as { message?: unknown }).message)
        ? (response as { message: string[] }).message
        : undefined;
    const message = details ? 'Validation failed' : exception.message;
    return { status, body: failure(code, message, details) };
  }

  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    body: failure(ErrorCode.INTERNAL_ERROR, 'An unexpected error occurred'),
  };
}

@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AppExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const { status, body } = toErrorResponse(exception);
    if (status >= 500) {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }
    host.switchToHttp().getResponse<Response>().status(status).json(body);
  }
}
