import { HttpStatus } from '@nestjs/common';

import { AppException } from './app.exception';

import { ErrorCode } from '../error-codes.enum';

/**
 * Base exception for authorization errors (403 Forbidden).
 * Use when the user is authenticated but lacks permission for the requested action.
 */
export class ForbiddenException extends AppException {
  readonly code: ErrorCode;

  constructor(
    message: string,
    code: ErrorCode = ErrorCode.FORBIDDEN_INSUFFICIENT_PERMISSIONS,
    context?: Record<string, unknown>
  ) {
    super(HttpStatus.FORBIDDEN, message, context);
    this.code = code;
  }
}
