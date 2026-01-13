import { HttpStatus } from '@nestjs/common';

import { AppException } from './app.exception';

import { ErrorCode } from '../error-codes.enum';

/**
 * Base exception for external service errors (503 Service Unavailable).
 * Use when a third-party service (exchange API, CoinGecko, etc.) fails.
 */
export class ExternalServiceException extends AppException {
  readonly code: ErrorCode;

  constructor(message: string, code: ErrorCode = ErrorCode.EXTERNAL_EXCHANGE_ERROR, context?: Record<string, unknown>) {
    super(HttpStatus.SERVICE_UNAVAILABLE, message, context);
    this.code = code;
  }
}
