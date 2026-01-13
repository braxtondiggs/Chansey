import { BusinessRuleException } from '../base/business-rule.exception';
import { ErrorCode } from '../error-codes.enum';

/**
 * Thrown when order size constraints are violated.
 */
export class OrderSizeException extends BusinessRuleException {
  constructor(type: 'min' | 'max', value: number | string, limit: number | string, unit = 'quantity') {
    const message =
      type === 'min'
        ? `${unit.charAt(0).toUpperCase() + unit.slice(1)} ${value} is below minimum allowed ${limit}`
        : `${unit.charAt(0).toUpperCase() + unit.slice(1)} ${value} exceeds maximum allowed ${limit}`;
    const code = type === 'min' ? ErrorCode.BUSINESS_MIN_ORDER_SIZE : ErrorCode.BUSINESS_MAX_ORDER_SIZE;
    super(message, code, { type, value, limit, unit });
  }
}
