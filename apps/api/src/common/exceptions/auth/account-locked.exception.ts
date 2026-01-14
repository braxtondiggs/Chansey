import { TooManyRequestsException } from '../base/too-many-requests.exception';
import { ErrorCode } from '../error-codes.enum';

/**
 * Thrown when an account is locked due to too many failed login attempts.
 */
export class AccountLockedException extends TooManyRequestsException {
  constructor(minutesRemaining?: number) {
    const message = minutesRemaining
      ? `Account is locked. Try again in ${minutesRemaining} minutes.`
      : 'Account is locked due to too many failed attempts.';
    super(message, ErrorCode.AUTH_ACCOUNT_LOCKED, minutesRemaining ? { minutesRemaining } : undefined);
  }
}
