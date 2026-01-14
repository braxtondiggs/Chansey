import { HttpStatus } from '@nestjs/common';

import { AppException } from './app.exception';

import { ErrorCode } from '../error-codes.enum';

/**
 * Base exception for conflict errors (409 Conflict).
 * Use when a request conflicts with the current state (e.g., duplicate resources).
 */
export class ConflictException extends AppException {
  readonly code: ErrorCode;

  constructor(
    message: string,
    code: ErrorCode = ErrorCode.CONFLICT_DUPLICATE_RESOURCE,
    context?: Record<string, unknown>
  ) {
    super(HttpStatus.CONFLICT, message, context);
    this.code = code;
  }
}
