import { BusinessRuleException } from '../base/business-rule.exception';
import { ErrorCode } from '../error-codes.enum';

/**
 * Thrown when no valid quote currency can be resolved for a backtest.
 * This occurs when the preferred quote currency is not available in the database
 * and all fallback stablecoins (USDT, USDC, BUSD, DAI) are also unavailable.
 */
export class QuoteCurrencyNotFoundException extends BusinessRuleException {
  constructor(triedCurrencies: string[]) {
    super(
      `No valid quote currency found. Tried: [${triedCurrencies.join(', ')}]. ` +
        `Please ensure at least one stablecoin (USDT, USDC, etc.) exists in the database.`,
      ErrorCode.BUSINESS_QUOTE_CURRENCY_NOT_FOUND,
      { triedCurrencies }
    );
  }
}
