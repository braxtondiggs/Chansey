import { ConflictException } from '../base/conflict.exception';
import { ErrorCode } from '../error-codes.enum';

/**
 * Thrown when attempting to register with an email that already exists.
 */
export class EmailAlreadyExistsException extends ConflictException {
  constructor(message = 'User with this email already exists') {
    super(message, ErrorCode.CONFLICT_EMAIL_EXISTS);
  }
}
