import { HttpStatus } from '@nestjs/common';

import { AppException } from './app.exception';

import { ErrorCode } from '../error-codes.enum';

/**
 * Base exception for authentication errors (401 Unauthorized).
 * Use when the user cannot be authenticated or their session is invalid.
 */
export class AuthenticationException extends AppException {
  readonly code: ErrorCode;

  constructor(
    message: string,
    code: ErrorCode = ErrorCode.AUTH_INVALID_CREDENTIALS,
    context?: Record<string, unknown>
  ) {
    super(HttpStatus.UNAUTHORIZED, message, context);
    this.code = code;
  }
}
