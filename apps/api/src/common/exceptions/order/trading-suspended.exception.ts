import { BusinessRuleException } from '../base/business-rule.exception';
import { ErrorCode } from '../error-codes.enum';

/**
 * Thrown when trading is suspended for a symbol.
 */
export class TradingSuspendedException extends BusinessRuleException {
  constructor(symbol?: string) {
    const message = symbol
      ? `Trading is currently suspended for ${symbol}`
      : 'Trading is currently suspended for this symbol';
    super(message, ErrorCode.BUSINESS_TRADING_SUSPENDED, symbol ? { symbol } : undefined);
  }
}
