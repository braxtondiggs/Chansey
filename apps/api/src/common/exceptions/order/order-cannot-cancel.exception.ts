import { BusinessRuleException } from '../base/business-rule.exception';
import { ErrorCode } from '../error-codes.enum';

/**
 * Thrown when an order cannot be canceled due to its status.
 */
export class OrderCannotCancelException extends BusinessRuleException {
  constructor(status: string, reason?: string) {
    const message = reason || `Cannot cancel order with status "${status}"`;
    super(message, ErrorCode.BUSINESS_ORDER_CANNOT_CANCEL, { status });
  }
}
