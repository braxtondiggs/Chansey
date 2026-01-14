import { NotFoundException } from '../base/not-found.exception';
import { ErrorCode } from '../error-codes.enum';

/**
 * Thrown when an order cannot be found.
 */
export class OrderNotFoundException extends NotFoundException {
  constructor(orderId: string) {
    super(`Order with ID ${orderId} not found`, ErrorCode.NOT_FOUND_ORDER, { orderId });
  }
}
