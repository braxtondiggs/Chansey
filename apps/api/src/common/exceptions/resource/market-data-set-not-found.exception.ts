import { NotFoundException } from '../base/not-found.exception';
import { ErrorCode } from '../error-codes.enum';

/**
 * Thrown when a market data set cannot be found.
 */
export class MarketDataSetNotFoundException extends NotFoundException {
  constructor(id: string) {
    super(`Market data set with ID ${id} not found`, ErrorCode.NOT_FOUND_RESOURCE, {
      id,
      resourceType: 'MarketDataSet'
    });
  }
}
