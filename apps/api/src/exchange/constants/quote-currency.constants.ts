/**
 * Mapping of exchange slugs to their primary quote currency.
 * Covers all exchanges supported by ExchangeManagerService.
 */
export const EXCHANGE_QUOTE_CURRENCY: Record<string, string> = {
  binance_us: 'USDT',
  coinbase: 'USD',
  gdax: 'USD',
  kraken: 'USD'
};

export const DEFAULT_QUOTE_CURRENCY = 'USDT';

/** Currencies treated as USD-equivalent for pricing and pair filtering */
export const USD_QUOTE_CURRENCIES = new Set(['USD', 'USDT', 'USDC', 'BUSD', 'DAI', 'ZUSD']);
