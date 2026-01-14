import { HttpStatus } from '@nestjs/common';

import { AppException } from './app.exception';

import { ErrorCode } from '../error-codes.enum';

/**
 * Base exception for input validation errors (400 Bad Request).
 * Use for malformed requests, invalid input data, or constraint violations.
 */
export class ValidationException extends AppException {
  readonly code: ErrorCode;

  constructor(
    message: string,
    code: ErrorCode = ErrorCode.VALIDATION_INVALID_INPUT,
    context?: Record<string, unknown>
  ) {
    super(HttpStatus.BAD_REQUEST, message, context);
    this.code = code;
  }
}
