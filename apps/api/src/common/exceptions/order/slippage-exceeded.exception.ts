import { BusinessRuleException } from '../base/business-rule.exception';
import { ErrorCode } from '../error-codes.enum';

/**
 * Thrown when estimated slippage exceeds the maximum allowed.
 */
export class SlippageExceededException extends BusinessRuleException {
  constructor(estimatedSlippage: number, maxSlippage: number) {
    super(
      `Estimated slippage ${estimatedSlippage} bps exceeds maximum allowed ${maxSlippage} bps`,
      ErrorCode.BUSINESS_SLIPPAGE_EXCEEDED,
      { estimatedSlippage, maxSlippage }
    );
  }
}
