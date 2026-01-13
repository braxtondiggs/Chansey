import { NotFoundException } from '../base/not-found.exception';
import { ErrorCode } from '../error-codes.enum';

/**
 * Thrown when an exchange cannot be found.
 */
export class ExchangeNotFoundException extends NotFoundException {
  constructor(identifier: string, type: 'id' | 'slug' | 'name' = 'id') {
    super(`Exchange with ${type} ${identifier} not found`, ErrorCode.NOT_FOUND_EXCHANGE, { [type]: identifier });
  }
}
