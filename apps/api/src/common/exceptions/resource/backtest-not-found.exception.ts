import { NotFoundException } from '../base/not-found.exception';
import { ErrorCode } from '../error-codes.enum';

/**
 * Thrown when a backtest cannot be found.
 */
export class BacktestNotFoundException extends NotFoundException {
  constructor(id: string) {
    super(`Backtest with ID ${id} not found`, ErrorCode.NOT_FOUND_BACKTEST, { id });
  }
}
