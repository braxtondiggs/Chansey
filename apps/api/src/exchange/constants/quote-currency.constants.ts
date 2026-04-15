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

/** Stablecoin symbols excluded from trading optimization and concentration checks */
export const STABLECOIN_SYMBOLS = new Set(['USDT', 'USDC', 'DAI', 'BUSD', 'USD', 'TUSD', 'USDP', 'FDUSD', 'PYUSD']);

/** Currencies treated as USD-equivalent for pricing and pair filtering */
export const USD_QUOTE_CURRENCIES = new Set(['USD', 'USDT', 'USDC', 'BUSD', 'DAI', 'ZUSD']);

/**
 * Ordered priority list for selecting a quote currency from available accounts.
 * Fiat first, then stablecoins, then crypto bases.
 */
export const QUOTE_CURRENCY_PRIORITY = ['USD', 'EUR', 'GBP', 'USDT', 'USDC', 'BUSD', 'DAI', 'BTC', 'ETH'] as const;

/**
 * Select the best quote currency from a set of available currencies.
 * Iterates the priority list (not the input) so the result is deterministic
 * regardless of iteration order.
 *
 * @param currencies Available currency codes (e.g. from account records)
 * @returns The highest-priority currency found, or 'USD' as fallback
 */
export function getQuoteCurrency(currencies: Iterable<string>): string {
  const available = currencies instanceof Set ? currencies : new Set(currencies);
  for (const qc of QUOTE_CURRENCY_PRIORITY) {
    if (available.has(qc)) return qc;
  }
  return 'USD';
}
