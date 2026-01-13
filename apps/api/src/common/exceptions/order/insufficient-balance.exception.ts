import { BusinessRuleException } from '../base/business-rule.exception';
import { ErrorCode } from '../error-codes.enum';

/**
 * Thrown when there's insufficient balance to execute an order.
 */
export class InsufficientBalanceException extends BusinessRuleException {
  constructor(currency: string, available: number | string, required: number | string) {
    super(`Insufficient ${currency} balance: ${available} < ${required}`, ErrorCode.BUSINESS_INSUFFICIENT_BALANCE, {
      currency,
      available,
      required
    });
  }
}
