import { ValidationException } from '../base/validation.exception';
import { ErrorCode } from '../error-codes.enum';

/**
 * Thrown when a verification or reset token has expired.
 */
export class TokenExpiredException extends ValidationException {
  constructor(tokenType: 'verification' | 'reset' = 'verification') {
    const message = tokenType === 'verification' ? 'Verification token has expired' : 'Reset token has expired';
    super(message, ErrorCode.AUTH_TOKEN_EXPIRED);
  }
}
