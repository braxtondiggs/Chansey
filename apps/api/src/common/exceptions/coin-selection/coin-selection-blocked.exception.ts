import { BusinessRuleException } from '../base/business-rule.exception';
import { ErrorCode } from '../error-codes.enum';

/**
 * Thrown when a coin cannot be removed from a user's selection because they
 * have open positions (orders, paper trades, position exits, strategy positions, or pending signals)
 * in that coin.
 */
export class CoinSelectionBlockedException extends BusinessRuleException {
  constructor(coinSymbol: string, openPositionTypes: string[] = []) {
    const message = `Cannot remove ${coinSymbol} from your selection while you have an open position. Close the position first.`;
    super(message, ErrorCode.BUSINESS_COIN_SELECTION_BLOCKED, { coinSymbol, openPositionTypes });
  }
}
