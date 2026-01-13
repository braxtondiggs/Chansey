import { ValidationException } from '../base/validation.exception';
import { ErrorCode } from '../error-codes.enum';

/**
 * Thrown when a verification or reset token is invalid.
 */
export class InvalidTokenException extends ValidationException {
  constructor(tokenType: 'verification' | 'reset' = 'verification') {
    super(`Invalid ${tokenType} token`, ErrorCode.AUTH_TOKEN_INVALID);
  }
}
