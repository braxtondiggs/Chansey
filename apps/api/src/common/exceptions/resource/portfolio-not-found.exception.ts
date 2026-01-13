import { NotFoundException } from '../base/not-found.exception';
import { ErrorCode } from '../error-codes.enum';

/**
 * Thrown when a portfolio cannot be found.
 */
export class PortfolioNotFoundException extends NotFoundException {
  constructor(id: string) {
    super(`Portfolio with ID ${id} not found`, ErrorCode.NOT_FOUND_PORTFOLIO, { id });
  }
}
