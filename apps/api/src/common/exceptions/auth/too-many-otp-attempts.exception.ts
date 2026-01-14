import { TooManyRequestsException } from '../base/too-many-requests.exception';
import { ErrorCode } from '../error-codes.enum';

/**
 * Thrown when too many OTP verification attempts have been made.
 */
export class TooManyOtpAttemptsException extends TooManyRequestsException {
  constructor(message = 'Too many failed OTP attempts. Please request a new code.') {
    super(message, ErrorCode.AUTH_TOO_MANY_ATTEMPTS);
  }
}
