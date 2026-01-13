import { BusinessRuleException } from '../base/business-rule.exception';
import { ErrorCode } from '../error-codes.enum';

/**
 * Thrown when a trading pair/symbol is invalid or unavailable.
 */
export class InvalidSymbolException extends BusinessRuleException {
  constructor(symbol: string, exchangeName?: string) {
    const message = exchangeName
      ? `Trading pair ${symbol} is not available on ${exchangeName}`
      : `Trading pair ${symbol} is not available`;
    super(message, ErrorCode.BUSINESS_INVALID_SYMBOL, { symbol, exchangeName });
  }
}
