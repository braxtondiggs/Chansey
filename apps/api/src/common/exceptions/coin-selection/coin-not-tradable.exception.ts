import { ValidationException } from '../base/validation.exception';
import { ErrorCode } from '../error-codes.enum';

/**
 * Thrown when a user tries to add a coin to their selection that the engine
 * cannot price on any of their connected exchanges. "Tradable" here means the
 * coin has an active `exchange_symbol_map` row AND recent OHLC candle data
 * for at least one of the user's exchanges — symbol-map presence alone is
 * insufficient because some pairs are listed but not actively trading.
 */
export class CoinNotTradableOnUserExchangeException extends ValidationException {
  constructor(coinSymbol: string, context?: Record<string, unknown>) {
    super(
      `${coinSymbol} is not tradable on any of your connected exchanges. Connect an exchange that supports it or pick a different coin.`,
      ErrorCode.COIN_NOT_TRADABLE_ON_USER_EXCHANGE,
      { coinSymbol, ...context }
    );
  }
}
