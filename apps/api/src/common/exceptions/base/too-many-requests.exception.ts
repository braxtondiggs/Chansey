import { HttpStatus } from '@nestjs/common';

import { AppException } from './app.exception';

import { ErrorCode } from '../error-codes.enum';

/**
 * Base exception for rate limiting errors (429 Too Many Requests).
 * Use when the user has exceeded rate limits or retry thresholds.
 */
export class TooManyRequestsException extends AppException {
  readonly code: ErrorCode;

  constructor(message: string, code: ErrorCode = ErrorCode.AUTH_TOO_MANY_ATTEMPTS, context?: Record<string, unknown>) {
    super(HttpStatus.TOO_MANY_REQUESTS, message, context);
    this.code = code;
  }
}
