import { NotFoundException } from '../base/not-found.exception';
import { ErrorCode } from '../error-codes.enum';

/**
 * Thrown when a coin selection cannot be found.
 */
export class CoinSelectionNotFoundException extends NotFoundException {
  constructor(id: string) {
    super(`Coin selection with ID ${id} not found`, ErrorCode.NOT_FOUND_COIN_SELECTION, { id });
  }
}
