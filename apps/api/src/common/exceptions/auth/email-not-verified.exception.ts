import { ForbiddenException } from '../base';
import { ErrorCode } from '../error-codes.enum';

/**
 * Thrown when a user attempts to log in without verifying their email.
 */
export class EmailNotVerifiedException extends ForbiddenException {
  constructor(message = 'Please verify your email before logging in') {
    super(message, ErrorCode.AUTH_EMAIL_NOT_VERIFIED);
  }
}
