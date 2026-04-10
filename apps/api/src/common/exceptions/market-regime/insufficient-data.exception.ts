import { BusinessRuleException } from '../base/business-rule.exception';
import { ErrorCode } from '../error-codes.enum';

/**
 * Thrown when a calculation requires more data points than are available.
 */
export class InsufficientDataException extends BusinessRuleException {
  constructor(required: number, actual?: number) {
    const detail = actual !== undefined ? ` (got ${actual})` : '';
    super(`Insufficient data: need at least ${required} data points${detail}`, ErrorCode.BUSINESS_INSUFFICIENT_DATA, {
      required,
      actual
    });
  }
}
