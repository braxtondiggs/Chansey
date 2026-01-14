import { ValidationException } from '../base/validation.exception';
import { ErrorCode } from '../error-codes.enum';

/**
 * Thrown when an OTP code is invalid.
 */
export class InvalidOtpException extends ValidationException {
  constructor(message = 'Invalid OTP') {
    super(message, ErrorCode.AUTH_INVALID_OTP);
  }
}
