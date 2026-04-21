/**
 * Shared circuit-breaker key prefix for exchange ticker fetches.
 *
 * Both `PaperTradingMarketDataService` and `TickerBatcherService` point at
 * the same circuit so breaker state carries across the rollout and both
 * paths fail-fast in lockstep.
 *
 * The `paper-trading:` namespace is a historical artifact — it predates the
 * batcher being shared across callers. Cosmetic debt, not functional.
 */
export const TICKER_CIRCUIT_KEY_PREFIX = 'paper-trading:market-data';

export function tickerCircuitKey(exchangeSlug: string): string {
  return `${TICKER_CIRCUIT_KEY_PREFIX}:${exchangeSlug}`;
}
