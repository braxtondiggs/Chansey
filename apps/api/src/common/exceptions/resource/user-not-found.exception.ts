import { NotFoundException } from '../base/not-found.exception';
import { ErrorCode } from '../error-codes.enum';

/**
 * Thrown when a user cannot be found.
 */
export class UserNotFoundException extends NotFoundException {
  constructor(id?: string) {
    const message = id ? `User with ID ${id} not found` : 'User not found';
    super(message, ErrorCode.NOT_FOUND_USER, id ? { id } : undefined);
  }
}
