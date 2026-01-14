import { NotFoundException } from '../base/not-found.exception';
import { ErrorCode } from '../error-codes.enum';

/**
 * Thrown when a coin cannot be found.
 */
export class CoinNotFoundException extends NotFoundException {
  constructor(identifier: string, type: 'id' | 'slug' | 'symbol' = 'id') {
    super(`Coin with ${type} ${identifier} not found`, ErrorCode.NOT_FOUND_COIN, { [type]: identifier });
  }
}
