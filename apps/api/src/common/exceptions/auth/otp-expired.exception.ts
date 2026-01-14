import { ValidationException } from '../base/validation.exception';
import { ErrorCode } from '../error-codes.enum';

/**
 * Thrown when an OTP code has expired.
 */
export class OtpExpiredException extends ValidationException {
  constructor(message = 'OTP has expired') {
    super(message, ErrorCode.AUTH_OTP_EXPIRED);
  }
}
