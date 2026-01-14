import { NotFoundException } from '../base/not-found.exception';
import { ErrorCode } from '../error-codes.enum';

/**
 * Thrown when a strategy cannot be found.
 */
export class StrategyNotFoundException extends NotFoundException {
  constructor(id: string) {
    super(`Strategy with ID ${id} not found`, ErrorCode.NOT_FOUND_STRATEGY, { id });
  }
}
