import { HttpException, HttpStatus } from '@nestjs/common';

import { ErrorCode } from '../error-codes.enum';

/**
 * Base exception class for all application-specific exceptions.
 * Provides consistent error structure with error codes, messages, and optional context.
 */
export abstract class AppException extends HttpException {
  /**
   * Machine-readable error code for programmatic handling
   */
  abstract readonly code: ErrorCode;

  /**
   * Optional additional context about the error
   */
  readonly context?: Record<string, unknown>;

  /**
   * Timestamp when the error occurred
   */
  readonly timestamp: string;

  constructor(statusCode: HttpStatus, message: string, context?: Record<string, unknown>) {
    super(message, statusCode);
    this.context = context;
    this.timestamp = new Date().toISOString();

    // Capture stack trace, excluding constructor call
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Returns the structured error response
   */
  getErrorResponse(): {
    statusCode: number;
    code: ErrorCode;
    message: string;
    context?: Record<string, unknown>;
    timestamp: string;
  } {
    return {
      statusCode: this.getStatus(),
      code: this.code,
      message: this.message,
      ...(this.context && { context: this.context }),
      timestamp: this.timestamp
    };
  }
}
