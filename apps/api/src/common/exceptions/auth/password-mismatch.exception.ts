import { ValidationException } from '../base/validation.exception';
import { ErrorCode } from '../error-codes.enum';

/**
 * Thrown when password confirmation doesn't match.
 */
export class PasswordMismatchException extends ValidationException {
  constructor(message = 'Passwords do not match') {
    super(message, ErrorCode.AUTH_PASSWORD_MISMATCH);
  }
}
