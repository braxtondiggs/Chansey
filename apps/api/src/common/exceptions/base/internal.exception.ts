import { HttpStatus } from '@nestjs/common';

import { AppException } from './app.exception';

import { ErrorCode } from '../error-codes.enum';

/**
 * Base exception for internal server errors (500 Internal Server Error).
 * Use for unexpected errors that should not normally occur.
 */
export class InternalException extends AppException {
  readonly code: ErrorCode;

  constructor(
    message = 'An unexpected error occurred',
    code: ErrorCode = ErrorCode.INTERNAL_SERVER_ERROR,
    context?: Record<string, unknown>
  ) {
    super(HttpStatus.INTERNAL_SERVER_ERROR, message, context);
    this.code = code;
  }
}
