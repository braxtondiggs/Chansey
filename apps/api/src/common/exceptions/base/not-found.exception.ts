import { HttpStatus } from '@nestjs/common';

import { AppException } from './app.exception';

import { ErrorCode } from '../error-codes.enum';

/**
 * Base exception for resource not found errors (404 Not Found).
 * Use when a requested resource does not exist.
 */
export class NotFoundException extends AppException {
  readonly code: ErrorCode;

  constructor(message: string, code: ErrorCode = ErrorCode.NOT_FOUND_RESOURCE, context?: Record<string, unknown>) {
    super(HttpStatus.NOT_FOUND, message, context);
    this.code = code;
  }

  /**
   * Factory method for creating not found exceptions with consistent messaging
   */
  static forResource(
    resourceName: string,
    identifier?: Record<string, string | number>,
    code: ErrorCode = ErrorCode.NOT_FOUND_RESOURCE
  ): NotFoundException {
    let message: string;

    if (identifier) {
      const identifierStr = Object.entries(identifier)
        .map(([key, value]) => `${key}: ${value}`)
        .join(', ');
      message = `${resourceName} with ${identifierStr} not found`;
    } else {
      message = `${resourceName} not found`;
    }

    return new NotFoundException(message, code, identifier);
  }
}
