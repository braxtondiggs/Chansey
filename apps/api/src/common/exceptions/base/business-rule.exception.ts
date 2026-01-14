import { HttpStatus } from '@nestjs/common';

import { AppException } from './app.exception';

import { ErrorCode } from '../error-codes.enum';

/**
 * Base exception for business rule violations (422 Unprocessable Entity).
 * Use when the request is valid but violates business logic constraints.
 */
export class BusinessRuleException extends AppException {
  readonly code: ErrorCode;

  constructor(
    message: string,
    code: ErrorCode = ErrorCode.BUSINESS_TRADING_SUSPENDED,
    context?: Record<string, unknown>
  ) {
    super(HttpStatus.UNPROCESSABLE_ENTITY, message, context);
    this.code = code;
  }
}
