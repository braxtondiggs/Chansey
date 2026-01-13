import { AuthenticationException } from '../base/authentication.exception';
import { ErrorCode } from '../error-codes.enum';

/**
 * Thrown when login credentials are invalid (wrong email/password).
 */
export class InvalidCredentialsException extends AuthenticationException {
  constructor(message = 'Wrong credentials provided') {
    super(message, ErrorCode.AUTH_INVALID_CREDENTIALS);
  }
}
