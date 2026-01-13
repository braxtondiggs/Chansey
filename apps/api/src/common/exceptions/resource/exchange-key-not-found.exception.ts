import { NotFoundException } from '../base/not-found.exception';
import { ErrorCode } from '../error-codes.enum';

/**
 * Thrown when an exchange key cannot be found.
 */
export class ExchangeKeyNotFoundException extends NotFoundException {
  constructor(id?: string) {
    const message = id ? `Exchange key with ID ${id} not found` : 'Exchange key not found';
    super(message, ErrorCode.NOT_FOUND_EXCHANGE_KEY, id ? { id } : undefined);
  }
}
