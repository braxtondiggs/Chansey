import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { MESSAGES } from '@nestjs/core/constants';

import { FastifyReply, FastifyRequest } from 'fastify';

import { AppException, ErrorCode } from '../exceptions';

/**
 * Standardized error response format for all API errors.
 */
export interface ErrorResponse {
  statusCode: number;
  code: string;
  message: string;
  path: string;
  timestamp: string;
  context?: Record<string, unknown>;
}

/**
 * Global exception filter that handles all exceptions and returns consistent error responses.
 * Supports both custom AppException hierarchy and standard NestJS HttpExceptions.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    let errorResponse: ErrorResponse;

    if (exception instanceof AppException) {
      errorResponse = this.handleAppException(exception, request);
    } else if (exception instanceof HttpException) {
      errorResponse = this.handleHttpException(exception, request);
    } else {
      errorResponse = this.handleUnknownError(exception, request);
    }

    // Log the error with appropriate level
    this.logError(errorResponse, exception);

    response.status(errorResponse.statusCode).send(errorResponse);
  }

  /**
   * Handles custom AppException instances with full error code support.
   */
  private handleAppException(exception: AppException, request: FastifyRequest): ErrorResponse {
    return {
      statusCode: exception.getStatus(),
      code: exception.code,
      message: exception.message,
      path: request.url,
      timestamp: exception.timestamp,
      ...(exception.context && { context: exception.context })
    };
  }

  /**
   * Handles standard NestJS HttpException instances.
   * Maps to appropriate error codes based on status code.
   */
  private handleHttpException(exception: HttpException, request: FastifyRequest): ErrorResponse {
    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse();

    // Extract message from response (can be string or object with message property)
    let message: string;
    if (typeof exceptionResponse === 'string') {
      message = exceptionResponse;
    } else if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
      const responseObj = exceptionResponse as Record<string, unknown>;
      message = (responseObj.message as string) || exception.message;
    } else {
      message = exception.message;
    }

    return {
      statusCode: status,
      code: this.mapStatusToErrorCode(status),
      message,
      path: request.url,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Handles unknown errors (not HttpException subclasses).
   */
  private handleUnknownError(exception: unknown, request: FastifyRequest): ErrorResponse {
    // In production, don't expose internal error details
    const isProduction = process.env.NODE_ENV === 'production';
    const message = isProduction
      ? MESSAGES.UNKNOWN_EXCEPTION_MESSAGE
      : exception instanceof Error
        ? exception.message
        : 'An unexpected error occurred';

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCode.INTERNAL_UNEXPECTED_ERROR,
      message,
      path: request.url,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Maps HTTP status codes to appropriate error codes for standard exceptions.
   */
  private mapStatusToErrorCode(status: number): string {
    const statusCodeMap: Record<number, string> = {
      [HttpStatus.BAD_REQUEST]: ErrorCode.VALIDATION_INVALID_INPUT,
      [HttpStatus.UNAUTHORIZED]: ErrorCode.AUTH_INVALID_CREDENTIALS,
      [HttpStatus.FORBIDDEN]: ErrorCode.FORBIDDEN_INSUFFICIENT_PERMISSIONS,
      [HttpStatus.NOT_FOUND]: ErrorCode.NOT_FOUND_RESOURCE,
      [HttpStatus.CONFLICT]: ErrorCode.CONFLICT_DUPLICATE_RESOURCE,
      [HttpStatus.UNPROCESSABLE_ENTITY]: ErrorCode.BUSINESS_TRADING_SUSPENDED,
      [HttpStatus.TOO_MANY_REQUESTS]: ErrorCode.AUTH_TOO_MANY_ATTEMPTS,
      [HttpStatus.INTERNAL_SERVER_ERROR]: ErrorCode.INTERNAL_SERVER_ERROR,
      [HttpStatus.SERVICE_UNAVAILABLE]: ErrorCode.EXTERNAL_EXCHANGE_ERROR
    };

    return statusCodeMap[status] || ErrorCode.INTERNAL_UNEXPECTED_ERROR;
  }

  /**
   * Logs errors with appropriate severity based on status code.
   */
  private logError(errorResponse: ErrorResponse, exception: unknown): void {
    const logContext = {
      code: errorResponse.code,
      statusCode: errorResponse.statusCode,
      path: errorResponse.path,
      context: errorResponse.context
    };

    // Log 5xx errors as errors, 4xx as warnings
    if (errorResponse.statusCode >= 500) {
      this.logger.error(
        `${errorResponse.code}: ${errorResponse.message}`,
        exception instanceof Error ? exception.stack : undefined,
        logContext
      );
    } else if (errorResponse.statusCode >= 400) {
      this.logger.warn(`${errorResponse.code}: ${errorResponse.message}`, logContext);
    }
  }
}
